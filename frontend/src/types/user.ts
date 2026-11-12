export type UserRole = "admin" | "viewer";

export interface PublicUser {
	id: string;
	email: string;
	name: string;
	role: UserRole;
}
