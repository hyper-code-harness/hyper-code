import{expect,test}from"bun:test";import hash from"./hash";
test("video hash is stable and changes with transcript",()=>{const base={id:"abc",title:"Talk",description:"Desc",publishedAt:"2026-01-01T00:00:00Z"};const a=hash(null as any,null,base),b=hash(null as any,null,base),c=hash(null as any,null,{...base,transcript:"words"});expect(a).toBe(b);expect(c).not.toBe(a)});
