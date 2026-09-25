import { z } from "zod";
import { memoryTypes } from "../../modules/memory";
import { FIELD_DESCRIPTIONS as describe } from "../../modules/memory-protocol";
import { sessionIdentity } from "../../modules/sessions";
const path = z.string().trim().min(1).max(4096).refine(value => !value.includes("\0"));
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !value.includes("\0"));
const directory = path.optional().describe(describe.directory);
const id = text(128).describe(describe.id);
const sessionId = z.string().superRefine((value,context) => {
  try { sessionIdentity(value); }
  catch { context.addIssue({code:"custom",message:"sessionId debe tener entre 1 y 200 caracteres, sin controles ni espacios exteriores."}); }
}).describe(describe.sessionId);
const projectScope = z.enum(["project","shared","ecosystem"]).describe(describe.scope);
const searchScope = z.enum(["all","project","shared","ecosystem"]).describe(describe.searchScope);
const groupIntent = text(1000).describe(describe.groupIntent);

  const narrative=(maximum:number)=>z.string().max(maximum).refine(value=>!value.includes("\0"));
  const summaryFields=z.object({goal:text(4000),instructions:narrative(8000),discoveries:narrative(8000),accomplishments:narrative(8000),nextSteps:narrative(8000),files:z.array(path).max(200)}).strict().describe(describe.summary);

export const toolSchemas = {
  memory_current_project: z.object({ directory }).strict(),
  memory_search: z.object({ directory,query:text(500).describe(describe.query),limit:z.number().int().min(1).max(50).optional(),scope:searchScope.optional() }).strict(),
  memory_get: z.object({ directory,id,scope:projectScope.optional(),version:z.number().int().min(1).optional() }).strict(),
  memory_save: z.object({
      directory,scope:projectScope.optional(),globalIntent:text(1000).describe(describe.globalIntent).optional(),groupIntent:groupIntent.optional(),
      title:text(300).describe(describe.title),content:text(20_000).describe(describe.content),
      type:z.enum(memoryTypes).describe(describe.type),topicKey:text(300).describe(describe.topicKey).optional(),pinned:z.boolean().describe(describe.pinned).optional(),
      expectedVersion:z.number().int().min(1).describe(describe.expectedVersion).optional(),requestKey:text(300).describe(describe.requestKey).optional(),
      short:text(300).describe(describe.short).optional(),supersedes:id.describe(describe.supersedes).optional(),
      affects:z.array(text(64)).min(1).max(20).describe(describe.affects).optional(),
      sessionId:sessionId.optional(),sessionProjectId:id.optional(),
    }).strict(),
  memory_history: z.object({ directory,id,scope:projectScope.optional() }).strict(),
  memory_session_start: z.object({directory,sessionId}).strict(),
  memory_session_end: z.object({directory,sessionId}).strict(),
  memory_session_summary: z.object({directory,sessionId,summary:summaryFields,requestKey:text(300).describe(describe.requestKey),expectedVersion:z.number().int().min(1).describe(describe.expectedVersion).optional(),scope:z.literal("ecosystem").optional(),groupIntent:groupIntent.optional()}).strict(),
  memory_timeline: z.object({directory,sessionId,id,version:z.number().int().min(1),before:z.number().int().min(0).max(20).optional(),after:z.number().int().min(0).max(20).optional()}).strict(),
  memory_context: z.object({directory,scope:z.enum(["shared","ecosystem"]).optional(),compact:z.boolean().optional(),maxBytes:z.number().int().min(1024).max(65536).optional()}).strict(),
};
