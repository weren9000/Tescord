import { WorkspaceMessage } from '../models/workspace.models';

export function isMessageContinuation(current: WorkspaceMessage, previous: WorkspaceMessage | undefined): boolean {
  if (!previous || current.reply_to || current.author.id !== previous.author.id) return false;
  const at = new Date(current.created_at);
  const before = new Date(previous.created_at);
  const gap = at.getTime() - before.getTime();
  return gap >= 0 && gap < 5 * 60 * 1000 && at.toDateString() === before.toDateString();
}
