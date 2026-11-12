import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { emailSchema } from "../auth/routes.js";
import { issueAuthToken } from "../auth/tokens.js";
import type { Db } from "../db.js";
import { createSuccessResponse, httpError } from "../http/responses.js";
import { validate } from "../http/validate.js";

type Deps = { db: Db; clock: () => Date; publicBaseUrl: string };

const idParams = z.object({ id: z.uuid() });
const roleSchema = z.enum(["admin", "viewer"]);

export const createUserRoutes = (deps: Deps, requireAuth: RequestHandler): Router => {
	const { db, clock } = deps;
	const base = deps.publicBaseUrl.replace(/\/+$/, "");
	const router = Router();
	router.use(requireAuth, requireRole("admin"));

	router.get("/", async (_req, res) => {
		const users = await db.user.findMany({ orderBy: { created_at: "asc" } });
		res.json(
			createSuccessResponse(
				users.map((u) => ({
					id: u.id,
					email: u.email,
					name: u.name,
					role: u.role,
					deactivated: u.deactivated_at !== null,
					pendingInvite: u.password_hash === null,
					createdAt: u.created_at,
				})),
				{ count: users.length }
			)
		);
	});

	router.post(
		"/invites",
		validate({
			body: z.object({
				email: emailSchema,
				name: z.string().trim().min(1).max(200),
				role: roleSchema,
			}),
		}),
		async (req, res) => {
			const { email, name, role } = req.valid.body;
			const existing = await db.user.findUnique({ where: { email } });
			if (existing?.password_hash) {
				throw httpError(
					409,
					"EMAIL_TAKEN",
					"A user with this email already exists"
				);
			}
			// A pending invite is re-issued: same row, fresh link, updated name and role.
			const user = existing
				? await db.user.update({
						where: { id: existing.id },
						data: { name, role },
					})
				: await db.user.create({ data: { email, name, role } });
			const token = await issueAuthToken(db, user.id, "invite", clock());
			res.status(201).json(
				createSuccessResponse({ inviteUrl: `${base}/invite/${token}` })
			);
		}
	);

	router.patch(
		"/:id",
		validate({
			params: idParams,
			body: z
				.object({
					role: roleSchema.optional(),
					deactivated: z.boolean().optional(),
				})
				.refine(
					(b) => b.role !== undefined || b.deactivated !== undefined,
					"nothing to change"
				),
		}),
		async (req, res) => {
			const { role, deactivated } = req.valid.body;
			const updated = await db.$transaction(async (tx) => {
				// Serializes admin changes so two requests cannot each remove "the other" admin.
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(7002, 0)`;
				const target = await tx.user.findUnique({
					where: { id: req.valid.params.id },
				});
				if (!target) throw httpError(404, "NOT_FOUND", "User not found");
				const losesAdmin =
					target.role === "admin" &&
					!target.deactivated_at &&
					(role === "viewer" || deactivated === true);
				if (losesAdmin) {
					const others = await tx.user.count({
						where: {
							role: "admin",
							deactivated_at: null,
							id: { not: target.id },
						},
					});
					if (others === 0) {
						throw httpError(
							409,
							"LAST_ADMIN",
							"At least one active admin is required"
						);
					}
				}
				return tx.user.update({
					where: { id: target.id },
					data: {
						...(role !== undefined && { role }),
						...(deactivated !== undefined && {
							deactivated_at: deactivated
								? (target.deactivated_at ?? clock())
								: null,
						}),
					},
				});
			});
			res.json(
				createSuccessResponse({
					id: updated.id,
					email: updated.email,
					name: updated.name,
					role: updated.role,
					deactivated: updated.deactivated_at !== null,
				})
			);
		}
	);

	router.post("/:id/reset-link", validate({ params: idParams }), async (req, res) => {
		const user = await db.user.findUnique({ where: { id: req.valid.params.id } });
		if (!user) throw httpError(404, "NOT_FOUND", "User not found");
		if (user.deactivated_at)
			throw httpError(409, "USER_DEACTIVATED", "Reactivate the user first");
		const token = await issueAuthToken(db, user.id, "reset", clock());
		res.json(createSuccessResponse({ resetUrl: `${base}/reset/${token}` }));
	});

	return router;
};
