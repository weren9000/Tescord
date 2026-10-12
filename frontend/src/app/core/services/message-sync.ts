import { WorkspaceMessage, WorkspaceMessagePage } from '../models/workspace.models';

/** Re-read the loaded range and every subsequent page, including changed reactions. */
export async function synchronizeMessages(
  existing: WorkspaceMessage[],
  load: (from: string | null, after: string | null) => Promise<WorkspaceMessagePage>,
  isCurrent: () => boolean = () => true,
): Promise<WorkspaceMessage[]> {
  const messages = new Map<string, WorkspaceMessage>();
  let from: string | null = existing[0]?.id ?? null;
  let after: string | null = null;
  const seenCursors = new Set<string>();
  while (isCurrent()) {
    const page = await load(from, after);
    for (const message of page.items) { messages.set(message.id, message); }
    if (!page.has_newer) { break; }
    if (!page.next_after || seenCursors.has(page.next_after)) {
      throw new Error('Invalid message sync cursor');
    }
    seenCursors.add(page.next_after);
    from = null;
    after = page.next_after;
  }
  return [...messages.values()];
}
