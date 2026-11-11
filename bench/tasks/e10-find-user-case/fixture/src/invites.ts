export type Invite = { email: string; sentAt: string };

/** True when an invite to `email` was already sent. */
export function alreadyInvited(invites: Invite[], email: string): boolean {
  return invites.some((invite) => invite.email === email);
}
