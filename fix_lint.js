const fs = require('fs');
const files = [
    'src/app/household/page.tsx',
    'src/app/api/household/route.ts',
    'src/app/api/household/settings/route.ts',
    'src/app/api/household/member/route.ts',
    'src/app/api/household/lead/route.ts'
];

files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    
    // Replace (session.user as any) -> (session.user as {id: number})
    content = content.replace(/\(session\.user as any\)\.id/g, '(session.user as {id: number}).id');
    content = content.replace(/session\.user as any/g, 'session.user as {id: number}');
    
    // Replace (error: any) -> (error: unknown)
    content = content.replace(/\(error: any\)/g, '(error: unknown)');

    // Replace (p: any), (l: any), etc in household/page.tsx
    content = content.replace(/\(p: any\)/g, '(p: {id: number; name?: string; email?: string; dob?: string; homeAddress?: string})');
    content = content.replace(/\(l: any\)/g, '(l: {participantId: number})');
    content = content.replace(/\(pv: any\)/g, '(pv: {id: number; program: {name: string; end?: string}, events?: {start: string}[]})');
    content = content.replace(/\(pp: any\)/g, '(pp: {id: number; program: {name: string; end?: string}, events?: {start: string}[]})');
    content = content.replace(/useState<any\[\]>/g, 'useState<unknown[]>');

    // Remove unused error variables
    content = content.replace(/} catch \(error\) {/g, '} catch {');

    fs.writeFileSync(f, content);
});
console.log('Fixed');
