export type MembershipSource = "command" | "node-file" | "project-file";
export interface Group { id: string; name: string; createdAt: string }
export interface GroupMembership { projectId: string; groupId: string; boundAt: string; source: MembershipSource }
export interface GroupSummary extends Group { projects: { projectId: string; name: string }[] }
export interface ProjectGroup { group: Group; source: MembershipSource }
export interface GroupSource { groupId: string; projectId: string; setAt: string }
export interface IdentityEvent {
  id: number; action: string; projectId: string | null; groupId: string | null;
  previousGroupId: string | null; previousProjectId: string | null; memoryId: string | null; directory: string | null; createdAt: string;
}
