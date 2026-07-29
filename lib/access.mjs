/**
 * @param {{
 *   requesterId: string | null | undefined;
 *   ownerId: string | null | undefined;
 *   linkedPartnerId?: string | null;
 *   write?: boolean;
 * }} input
 */
export function canAccessState({
  requesterId,
  ownerId,
  linkedPartnerId = null,
  write = false,
}) {
  if (!requesterId || !ownerId) return false;
  if (requesterId === ownerId) return true;
  if (write) return false;
  return linkedPartnerId === ownerId;
}
