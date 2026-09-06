import { afterEach,describe,expect,it,vi } from "vitest";
import { createDatabase } from "../src/lib/db";
import { submitAcquisition } from "../src/lib/acquisition";

afterEach(()=>{vi.unstubAllGlobals();delete process.env.BOOKORBIT_URL;delete process.env.BOOKORBIT_TOKEN;});

describe("BookOrbit availability ownership",()=>{
  it("queues strict finalization for an already-owned book without posting a duplicate request",async()=>{
    process.env.BOOKORBIT_URL="http://bookorbit.test:3000";
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify([{ownedBookId:91,existingRequestId:null,existingRequestStatus:null,alreadySubscribed:false}]),{status:200,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetchMock);
    const db=createDatabase(":memory:");
    const result=await submitAcquisition(db,{title:"Verified Work",author:"A. Writer",isbn13:"9780306406157",language:"eng",providerKey:"openlibrary",providerId:"OL1W"},"12");
    expect(result).toMatchObject({alreadyOwned:true});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/book-requests/availability");
    expect(db.prepare("SELECT type,status FROM jobs").get()).toEqual({type:"finalize_owned_book",status:"queued"});
    expect(db.prepare("SELECT status,upstream_book_id,target_collection_id FROM acquisitions").get()).toEqual({status:"available_in_bookorbit",upstream_book_id:"91",target_collection_id:"12"});
    const repeat=await submitAcquisition(db,{title:"Verified Work",author:"A. Writer",isbn13:"9780306406157",language:"eng"},"12");
    expect(repeat.idempotent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    db.close();
  });
});
