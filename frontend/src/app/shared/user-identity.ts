export function formatPublicUserId(publicId: number | null | undefined): string {
  if (typeof publicId !== 'number' || !Number.isFinite(publicId)) {
    return '00000';
  }

  return Math.trunc(publicId).toString().padStart(5, '0');
}
