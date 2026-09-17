import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { directoryResolver } from "./project-directory";
import { sdkHarness } from "./__tests__/sdk-harness";

test("explicit directories override ambiguous roots and a single root is decoded from its file URL", async () => {
  const one=await sdkHarness(undefined,[pathToFileURL("/tmp/project with spaces").href]);
  try {expect(await directoryResolver(one.server)()).toBe("/tmp/project with spaces");}
  finally {await one.close();}
  const many=await sdkHarness(undefined,["file:///tmp/one","file:///tmp/two"]);
  try {
    expect(await directoryResolver(many.server)("/explicit")).toBe("/explicit");
    await expect(directoryResolver(many.server)()).rejects.toMatchObject({code:"AMBIGUOUS_PROJECT"});
  } finally {await many.close();}
});
test("resolver rejects malformed file URLs accepted by the SDK file prefix check",async()=>{
  const h=await sdkHarness(undefined,["file://["]);
  try {await expect(directoryResolver(h.server)()).rejects.toMatchObject({code:"INVALID_DIRECTORY"});}
  finally {await h.close();}
});
