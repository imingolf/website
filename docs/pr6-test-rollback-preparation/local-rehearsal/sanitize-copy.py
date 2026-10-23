#!/usr/bin/env python3
"""Offline sanitization of pg_restore's application-only COPY SQL; no DB access."""
import json
import re
import sys
import uuid

def decode(s):
    def sub(m):
        v=m.group(1)
        if v[0] in '01234567': return chr(int(v,8))
        if v.startswith('x'): return chr(int(v[1:],16))
        return {'b':'\b','f':'\f','n':'\n','r':'\r','t':'\t','v':'\v'}.get(v,v)
    return re.sub(r'\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)',sub,s)

def encode(s):
    return s.replace('\\','\\\\').replace('\t','\\t').replace('\n','\\n').replace('\r','\\r')

secrets={'adminPin','adminSetupToken'}
def scrub(x):
    if isinstance(x,dict): return {k:scrub(v) for k,v in x.items() if k not in secrets}
    if isinstance(x,list): return [scrub(v) for v in x]
    return x

table=None
columns=[]
tables_seen=set()
for line in sys.stdin:
    if table is not None:
        if line.rstrip('\r\n') == '\\.':
            table=None
        else:
            values=line.rstrip('\r\n').split('\t')
            if len(values)!=len(columns): raise SystemExit('Unexpected COPY column count')
            if table=='iig_private.group_owners':
                values[columns.index('invite_token')]=str(uuid.uuid4())
            if table=='public.tens_in_groups':
                i=columns.index('state')
                values[i]=encode(json.dumps(scrub(json.loads(decode(values[i]))),ensure_ascii=False,separators=(',',':')))
            line='\t'.join(values)+'\n'
    else:
        m=re.match(r'^COPY ([a-z_]+\.[a-z_]+) \(([^)]+)\) FROM stdin;\s*$',line)
        if m:
            table=m.group(1)
            if not table.startswith(('public.','iig_private.')):
                raise SystemExit('Refusing non-application data: '+table)
            columns=[s.strip() for s in m.group(2).split(',')]
            tables_seen.add(table)
    sys.stdout.write(line)
if table is not None: raise SystemExit('Unterminated COPY')
if not {'public.tens_in_groups','iig_private.group_owners'} <= tables_seen:
    raise SystemExit('Expected golf/owner COPY data absent; stop and review')
