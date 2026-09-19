export { resolveAssistantPaths, coverageWarnings } from "../infrastructure/assistants/catalog";
export { AssistantConfigurationError, planAssistantConfiguration, preflightAssistantConfiguration, applyAssistantConfiguration, planAssistantRemoval, applyAssistantRemoval } from "../infrastructure/assistants/configuration";
export type { ConfigurationPlan, ConfigurationResult } from "../infrastructure/assistants/configuration";
export { testInstalledServer } from "../infrastructure/assistants/self-test";
export type { ServerTestResult } from "../infrastructure/assistants/self-test";
export { resolveInstalledEngram } from "../infrastructure/assistants/installation";

import { CLIENT_IDS, type AssistantOptions, type AssistantDescriptor } from "../modules/assistants";
import { inspectAssistant } from "../infrastructure/assistants/catalog";
import { AssistantConfigurationError, planAssistantConfiguration } from "../infrastructure/assistants/configuration";

/** Combine installation evidence with a safe configuration preview for each client. */
export function detectAssistants(options:AssistantOptions={}):AssistantDescriptor[]{
  return CLIENT_IDS.map(id=>{
    const descriptor=inspectAssistant(id,options);
    if(descriptor.configuration.status==='blocked')return descriptor;
    try{
      const plan=planAssistantConfiguration(id,options.engramExecutable??process.execPath,options);
      descriptor.configuration={...descriptor.configuration,status:plan.writes.length===0?'configured':descriptor.detected.configFound?'needs-configuration':'absent'};
    }catch(error){
      const code=error instanceof AssistantConfigurationError?error.code:'IO_ERROR';
      descriptor.configuration={...descriptor.configuration,status:code==='CONFLICT'?'conflict':code==='MALFORMED'?'malformed':'blocked',message:error instanceof AssistantConfigurationError?error.message:'Could not safely inspect configuration.'};
    }
    return descriptor;
  });
}
