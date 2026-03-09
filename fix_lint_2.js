const fs = require('fs');
let content = fs.readFileSync('src/app/household/page.tsx', 'utf8');
content = content.replace(/useState<any>\(null\)/g, 'useState<Record<string, unknown> | null>(null)');
content = content.replace(/useState<any\[\]>\(\[\]\)/g, 'useState<Record<string, unknown>[]>([])');
content = content.replace(/session\?\.user as any/g, 'session?.user as {id: number}');
fs.writeFileSync('src/app/household/page.tsx', content);
