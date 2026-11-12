#!/bin/sh
# Daily Postgres dump + uploads archive into /backups, pruned after RETENTION_DAYS.
# Needs PGHOST, PGUSER, PGPASSWORD, PGDATABASE in the environment.
# Failures print "backup FAILED (<step>)" to stderr, which `docker compose logs backup` shows.
set -u

RETENTION_DAYS="${RETENTION_DAYS:-30}"
HOUR_UTC="${BACKUP_HOUR_UTC:-3}"

fail() {
	echo "backup FAILED ($1)" >&2
	rm -f "/backups/mgi-db-$stamp.dump.part" "/backups/mgi-uploads-$stamp.tar.gz.part"
	return 1
}

# `set -e` is not on (only `set -u`), so every step is checked by hand.
backup() {
	stamp="$(date -u +%Y-%m-%d_%H%M%S)"
	db="/backups/mgi-db-$stamp.dump"
	up="/backups/mgi-uploads-$stamp.tar.gz"
	# .part names + rename: a crash never leaves a file that looks complete.
	pg_dump --format=custom --file="$db.part" || { fail "pg_dump"; return 1; }
	mv "$db.part" "$db" || { fail "rename dump"; return 1; }
	tar -czf "$up.part" -C /uploads . || { fail "uploads archive"; return 1; }
	mv "$up.part" "$up" || { fail "rename uploads archive"; return 1; }
	# Prune only after a full success, so an outage never eats the last good backups.
	find /backups -type f \( -name 'mgi-db-*' -o -name 'mgi-uploads-*' \) \
		-mtime "+$((RETENTION_DAYS - 1))" -delete || { fail "prune"; return 1; }
	echo "backup $stamp done"
}

# First start: take one right away so there is never a window with no backup at all.
if ! ls /backups/mgi-db-*.dump >/dev/null 2>&1; then
	backup
fi

while true; do
	now=$(($(date -u +%s) % 86400))
	wait=$(((HOUR_UTC * 3600 - now + 86400) % 86400))
	[ "$wait" -lt 60 ] && wait=60
	sleep "${TEST_SLEEP:-$wait}"
	backup
	[ -n "${TEST_ONCE:-}" ] && exit 0
done
