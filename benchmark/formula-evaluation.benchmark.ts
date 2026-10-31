import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { projectRelations } from '../src/database/relations.js';
import { serializeDatabase } from '../src/database/schema.js';
import { filterDatabaseRows, sortDatabaseRows } from '../ui/src/database-table.js';
import { groupDatabaseRows } from '../ui/src/database-view-layout.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const DB=id(1),SOURCE=id(2),DOUBLE=id(3),CHAIN=id(4);
it('measures formula projection and typed query operations at scale',()=>{
  const schema={id:DB,name:'Formula benchmark',properties:[{id:SOURCE,name:'Source',type:'number' as const},{id:DOUBLE,name:'Double',type:'formula' as const,formula:{expression:`@{${SOURCE}} * 2`}},{id:CHAIN,name:'Chain',type:'formula' as const,formula:{expression:`@{${DOUBLE}} + 1`}}]};
  expect(JSON.parse(serializeDatabase(schema)).version).toBe(3);
  const results=[];
  for(const count of [100,500,1000,5000]){
    const notes=Array.from({length:count},(_,i)=>({...createNote({id:id(100+i),title:`Row ${i}`,path:`${i}.md`,body:'',now:'2026-01-01T00:00:00Z'}),extraFrontmatter:{nodus_data:{format:'nodus-note-properties',version:1,databases:{[DB]:{[SOURCE]:i}}}}}));
    const start=performance.now(),graph=projectRelations(notes,new Map([[DB,schema]])),projectMs=performance.now()-start;
    const rows=notes.map(note=>({...(graph.rows.get(note.id)!.get(DB)!),title:note.title,updatedAt:note.updatedAt,contentHash:'',issues:graph.rows.get(note.id)!.get(DB)!.issues})) as UiDatabaseRow[];
    const queryStart=performance.now();const sorted=sortDatabaseRows(rows,schema.properties,DOUBLE,'desc');const filtered=filterDatabaseRows(sorted,schema.properties,[{id:'f',propertyId:DOUBLE,operator:'greater',value:count}]);const groups=groupDatabaseRows(filtered,schema.properties[2]!);const queryMs=performance.now()-queryStart;
    results.push({records:count,projectMs:+projectMs.toFixed(2),sortFilterGroupMs:+queryMs.toFixed(2),lastFormula:rows.at(-1)?.values[CHAIN],matching:filtered.length,groups:groups.length});
  }
  console.info(JSON.stringify({benchmark:'formula-projection-query',results}));expect(results.at(-1)?.lastFormula).toBe(9999);
});
