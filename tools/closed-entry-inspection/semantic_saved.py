#!/usr/bin/env python3
"""Local-only structural semantic aid for saved triggers/constraints. Never executes SQL.
No raw definitions, identifiers, literals or credentials are emitted. Unsupported
PL/pgSQL constructs are reported, never silently treated as analysed semantics.
"""
import json
import re
from pathlib import Path
import sys
import classify_saved_calls as classifier
import followup_runner as driver
import prepare_followup as prep
import review_followup as reviewer
import summarise

SAFE_WORDS=set('and or not is distinct from null true false exists new old tg_op coalesce nullif greatest least select where in as into values set excluded on conflict do nothing update insert delete returning join left right inner outer full lateral case when then else end any all array begin count sum filter over partition by order group having limit offset asc desc found'.split())|classifier.BUILTINS
TOPICS={
 'history':{'history','rounds','roundhistory','round_history'},
 'payment_snapshot':{'paid','payment','payments','paymentmarkedat','payment_status','stake','pot','payouts','payout','payment_snapshot','payment_snapshots'},
 'league_award':{'league','leagues','leaguepoints','league_points','leaguewins','league_wins','totalwins','totalpoints','awards'},
 'trip_progression':{'trip','currentround','current_round','totalrounds','total_rounds','completed','standings','teamstandings','champion','active'},
 'round_transition':{'roundopen','round_open','roundid','round_id','scoresubmitted','stableford','netscore','noreturn'} }
SAFE_KEYS=set().union(*TOPICS.values())|{'roundOpen','roundId','scoreSubmitted','netScore','noReturn','paymentMarkedAt','currentRound','totalRounds','teamStandings','leaguePoints','leagueWins','totalWins','totalPoints'}
class Unsupported(ValueError):pass

def lex(text):
    out=[];i=0
    while i<len(text):
        if text[i].isspace():i+=1;continue
        if text.startswith('--',i):
            end=text.find('\n',i);i=len(text) if end<0 else end;continue
        if text.startswith('/*',i):
            depth=1;i+=2
            while i<len(text) and depth:
                if text.startswith('/*',i):depth+=1;i+=2
                elif text.startswith('*/',i):depth-=1;i+=2
                else:i+=1
            if depth:raise Unsupported('comment')
            continue
        if text[i] in "'\"":
            quote=text[i];i+=1;value=''
            while i<len(text):
                c=text[i];i+=1
                if c=='\\':raise Unsupported('escaped_literal_or_identifier')
                if c==quote:
                    if i<len(text) and text[i]==quote:value+=quote;i+=1;continue
                    break
                value+=c
            else:raise Unsupported('unterminated_quote')
            out.append(('literal' if quote=="'" else 'identifier',value));continue
        if re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$',text[i:]):raise Unsupported('inner_dollar_literal')
        m=re.match(r'[A-Za-z_][A-Za-z_0-9$]*',text[i:])
        if m:out.append(('word',m[0].lower()));i+=len(m[0]);continue
        m=re.match(r'(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?',text[i:])
        if m:out.append(('number',m[0]));i+=len(m[0]);continue
        m=re.match(r'#>>|->>|::|:=|<>|!=|<=|>=|->|#>|\|\||[().,;=<>+*/%:\[\]?|-]',text[i:])
        if not m:raise Unsupported('unknown_token')
        out.append(('operator',m[0]));i+=len(m[0])
        if len(out)>30000:raise Unsupported('token_limit')
    if len(out)>30000:raise Unsupported('token_limit')
    return out

def word(t,value):return t==('word',value)
def topics(tokens):
    seen={v.lower() for k,v in tokens if k in ('word','identifier','literal')}
    return sorted(k for k,v in TOPICS.items() if seen&v)

class Symbols:
    def __init__(self):self.ids={};self.values={}
    def render(self,tokens):
        if len(tokens)>400:raise Unsupported('expression_limit')
        result=[]
        for kind,value in tokens:
            if kind=='operator':result.append(value)
            elif kind=='word' and value in SAFE_WORDS:result.append(value.upper())
            elif kind=='literal' and value in SAFE_KEYS:result.append('FIELD_KEY:'+value)
            elif kind=='literal' and value in ('INSERT','UPDATE','DELETE','TRUNCATE'):result.append('EVENT:'+value)
            elif kind in ('literal','number'):
                result.append(self.values.setdefault((kind,value),'constant_'+str(len(self.values)+1)))
            else:result.append(self.ids.setdefault((kind,value),'symbol_'+str(len(self.ids)+1)))
        return result

def identifier(tokens,start=0):
    if start>=len(tokens) or tokens[start][0] not in ('word','identifier'):raise Unsupported('identifier')
    result=[tokens[start][1]];i=start+1
    while i<len(tokens) and tokens[i]==('operator','.'):
        if i+1>=len(tokens) or tokens[i+1][0] not in ('word','identifier'):raise Unsupported('identifier')
        result.append(tokens[i+1][1]);i+=2
    return result,i

def comma_names(tokens):
    result=[]
    for i,t in enumerate(tokens):
        if i%2==0:
            if t[0] not in ('word','identifier'):raise Unsupported('expression_conflict_target')
            result.append(t[1])
        elif t!=('operator',','):raise Unsupported('expression_conflict_target')
    if not result or len(tokens)%2==0:raise Unsupported('empty_conflict_target')
    return result

class Review:
    def __init__(self,tokens,symbols,tables):self.tokens=tokens;self.i=0;self.symbols=symbols;self.tables=tables;self.events=[]
    def at(self,*values):return all(self.i+n<len(self.tokens) and word(self.tokens[self.i+n],v) for n,v in enumerate(values))
    def take(self,terminator):
        start=self.i;depth=0;cases=0
        while self.i<len(self.tokens):
            t=self.tokens[self.i]
            if depth==0 and cases==0 and ((t==('operator',';')) if terminator==';' else word(t,terminator)):
                value=self.tokens[start:self.i];self.i+=1;return value
            if t==('operator','('):depth+=1
            elif t==('operator',')'):depth-=1
            elif word(t,'case'):cases+=1
            elif word(t,'end') and cases:cases-=1
            if depth<0:raise Unsupported('unbalanced_expression')
            self.i+=1
        raise Unsupported('missing_terminator')
    def sequence(self,guards,loops):
        if len(guards)+len(loops)>24:raise Unsupported('nesting_limit')
        while self.i<len(self.tokens):
            if self.at('end') or self.at('else') or self.at('elsif'):return
            if self.at('exception') or self.at('case'):raise Unsupported('exception_or_statement_case')
            if self.at('if'):
                self.i+=1;condition=self.take('then');prior=[]
                while True:
                    gate={'condition':self.symbols.render(condition),'topics_NOT_effect_proof':topics(condition),'earlier_conditions_false':[self.symbols.render(c) for c in prior]}
                    self.sequence(guards+[gate],loops)
                    prior.append(condition)
                    if self.at('elsif'):self.i+=1;condition=self.take('then');continue
                    if self.at('else'):
                        self.i+=1;self.sequence(guards+[{'else_of':[self.symbols.render(c) for c in prior]}],loops)
                    if not self.at('end','if'):raise Unsupported('if_structure')
                    self.i+=2
                    if self.i>=len(self.tokens) or self.tokens[self.i]!=('operator',';'):raise Unsupported('if_terminator')
                    self.i+=1;break
                continue
            if self.at('for') or self.at('foreach') or self.at('while') or self.at('loop'):
                header=self.take('loop')
                self.sequence(guards,loops+[self.symbols.render(header)])
                if not self.at('end','loop'):raise Unsupported('loop_structure')
                self.i+=2
                if self.i>=len(self.tokens) or self.tokens[self.i]!=('operator',';'):raise Unsupported('loop_label_or_terminator')
                self.i+=1;continue
            if self.at('begin'):
                self.i+=1;self.sequence(guards,loops)
                if not self.at('end') or self.at('end','if') or self.at('end','loop'):raise Unsupported('block_structure')
                self.i+=1
                if self.i<len(self.tokens) and self.tokens[self.i]==('operator',';'):self.i+=1
                continue
            statement=self.take(';')
            if not statement:continue
            if any(word(t,'execute') for t in statement):raise Unsupported('dynamic_sql')
            first=statement[0]
            if word(first,'with'):raise Unsupported('cte_requires_review')
            if first[0]=='word' and first[1] in ('insert','update','delete'):
                self.events.append(self.write(statement,guards,loops))
            elif ('operator',':=') in statement or word(first,'select') or word(first,'perform') or word(first,'return') or word(first,'raise'):
                self.events.append({'kind':'control_transfer' if first[1] in ('return','raise') else 'dataflow_or_control','topics_NOT_effect_proof':topics(statement),
                  'symbolic_expression':self.symbols.render(statement),'branch_path':guards,'iteration_context':loops})
            else:raise Unsupported('unrecognised_statement')
            if len(self.events)>160:raise Unsupported('event_limit')
    def write(self,statement,guards,loops):
        operation=statement[0][1];start=1
        if operation=='insert':
            if not word(statement[start],'into'):raise Unsupported('insert_target')
            start+=1
        elif operation=='delete':
            if not word(statement[start],'from'):raise Unsupported('delete_target')
            start+=1
        target,end=identifier(statement,start)
        matches=[(i,t) for i,t in enumerate(self.tables,1) if (target==[t['schema'],t['name']] if len(target)==2 else target==[t['name']])]
        result={'kind':'write','operation':operation,'target_candidates':[i for i,t in matches],
          'qualified_target_matches_saved_relation':len(target)==2 and len(matches)==1,
          'branch_path':guards,'iteration_context':loops,
          'preceding_control_event_numbers':[i for i,e in enumerate(self.events,1) if e['kind']=='control_transfer'],
          'reachability_verified':False,'topics_NOT_effect_proof':topics(statement),
          'symbolic_statement':self.symbols.render(statement),'conflict':{'present':False}}
        if len(matches)!=1:result['target_review_required']=True
        positions=[i for i in range(len(statement)-1) if word(statement[i],'on') and word(statement[i+1],'conflict')]
        if len(positions)>1:raise Unsupported('multiple_conflict_clauses')
        if positions:
            i=positions[0]+2;conflict={'present':True,'arbiter_verified':False}
            do=next((j for j in range(i,len(statement)) if word(statement[j],'do')),None)
            if do is None:raise Unsupported('conflict_action')
            spec=statement[i:do];action=statement[do+1:]
            if not action or action[0] not in [('word','nothing'),('word','update')]:raise Unsupported('conflict_action')
            conflict['action']='nothing' if word(action[0],'nothing') else 'update'
            conflict['targetless']=not spec
            conflict['matching_constraints']=[]
            if len(matches)==1:
                table=matches[0][1]
                if len(spec)==3 and word(spec[0],'on') and word(spec[1],'constraint'):
                    conflict['matching_constraints']=[j for j,c in enumerate(table['constraints'],1) if c['name']==spec[2][1]]
                elif spec and spec[0]==('operator','(') and spec[-1]==('operator',')'):
                    cols=comma_names(spec[1:-1]);conflict['column_symbols']=self.symbols.render(spec[1:-1])
                    for j,c in enumerate(table['constraints'],1):
                        ct=lex(c['definition']);opening=next((k for k,t in enumerate(ct) if t==('operator','(')),None)
                        closing=next((k for k,t in enumerate(ct) if t==('operator',')')),None)
                        if c['type'] in ('u','p') and opening is not None and closing is not None:
                            try:cc=comma_names(ct[opening+1:closing])
                            except Unsupported:continue
                            if set(cc)==set(cols):conflict['matching_constraints'].append(j)
                elif spec:conflict['expression_or_predicate_target_requires_review']=True
                conflict['matched_constraint_metadata']=[{'constraint_number':j,
                  'validated':table['constraints'][j-1]['validated'],
                  'deferrable':table['constraints'][j-1]['deferrable']} for j in conflict['matching_constraints']]
            conflict['remaining_review']='index expressions/predicates, null semantics, deferral, values and conflict-update filters'
            result['conflict']=conflict
        return result


def analyse(original,rows,report,params):
    reviewer.review(rows,report,params)
    parts={r['section']:r for r in rows};tables=parts['target_constraints_indexes']['items'];symbols=Symbols()
    bodies={}
    def remember(oid,body):
        key=prep.oid(oid)
        if key in bodies:prep.require(bodies[key]==body)
        bodies[key]=body
    for section in original:
        if section['section']=='functions':
            for f in section['items']:remember(f['oid'],f['definition'])
        elif section['section']=='triggers':
            for t in section['items']:remember(t['function_oid'],t['function_definition'])
    for f in parts['candidate_bindings']['items']:
        if f.get('definition') is not None:remember(f['oid'],f['definition'])
    output=[]
    for trigger in parts['target_trigger_dependencies']['items']:
        if trigger['internal']:continue
        oid=prep.oid(trigger['function_oid'])
        if trigger.get('definition_body') is not None:remember(oid,trigger['definition_body'])
        item={'trigger_number':len(output)+1,'target_number':next(i for i,t in enumerate(tables,1) if prep.oid(t['table_oid'])==prep.oid(trigger['table_oid'])),
          'insert_event':bool(int(trigger['type_bits'])&4),'update_event':bool(int(trigger['type_bits'])&16),
          'delete_event':bool(int(trigger['type_bits'])&8),'row_level':bool(int(trigger['type_bits'])&1),
          'before':bool(int(trigger['type_bits'])&2),'after':not bool(int(trigger['type_bits'])&(2|64)),'instead_of':bool(int(trigger['type_bits'])&64),
          'enabled_normal_or_always':trigger['enabled'] in ('O','A'),
          'trigger_clause_symbolic':symbols.render(lex(trigger['definition']))}
        try:
            if oid not in bodies:raise Unsupported('missing_saved_body')
            body=classifier.review_saved.body(bodies[oid]);tokens=lex(body)
            start=next((i for i,t in enumerate(tokens) if word(t,'begin')),None)
            if start is None:raise Unsupported('non_plpgsql_or_no_begin')
            # Declarations can carry initialisers/calls, so retain symbolic dataflow.
            declarations=tokens[:start]
            review=Review(tokens,symbols,tables);review.i=start;review.sequence([],[])
            if review.i!=len(tokens):raise Unsupported('unconsumed_body')
            item.update(status='STRUCTURAL_PATHS_EXTRACTED_NOT_SEMANTIC_PROOF',
              body_topic_references_NOT_effect_proof=topics(tokens),
              topic_event_index_NOT_effect_proof={topic:[i for i,event in enumerate(review.events,1) if topic in event.get('topics_NOT_effect_proof',[]) or any(topic in gate.get('topics_NOT_effect_proof',[]) for gate in event.get('branch_path',[]))] for topic in TOPICS},
              declarations=symbols.render(declarations),events=review.events)
        except Unsupported as error:
            # Reasons are exclusively fixed codes created in this module.
            item.update(status='UNSUPPORTED_REQUIRES_PRIVATE_REVIEW',reason=error.args[0])
        output.append(item)
    constraints=[]
    for i,t in enumerate(tables,1):
        constraints.append({'target_number':i,'constraints':[{'constraint_number':j,
          'kind':c['type'] if c['type'] in ('p','u','f','c','x','n') else 'other',
          'validated':prep.boolean(c['validated']),'deferrable':prep.boolean(c['deferrable']),
          'initially_deferred':prep.boolean(c['initially_deferred']),
          'symbolic_definition':symbols.render(lex(c['definition']))} for j,c in enumerate(t['constraints'],1)],
          'indexes':[{'index_number':j,'unique':prep.boolean(x['unique']),'valid':prep.boolean(x['valid']),
            'ready':prep.boolean(x['ready']),'partial':x['predicate'] is not None,
            'symbolic_definition':symbols.render(lex(x['definition']))} for j,x in enumerate(t['indexes'],1)]})
    return {'project':prep.PROJECT,'database_connections':0,'group_records_read':0,
      'saved_collection_guards_passed':True,'triggers':output,'target_constraints':constraints,
      'limitations':['Symbolic constants hide values; matching symbols mean identical token values, not proven expression equivalence.',
        'Topic matches are references only: they do not prove an award/payment write or legitimate round transition.',
        'Branch paths are lexical nesting, not reachability: preceding returns/raises, loop iterations and helper calls can change execution; review control-event references.',
        'SELECT/RETURN/PERFORM expressions may invoke helpers; this is not a transitive side-effect or PostgreSQL binding proof.',
        'Conflict matches are structural candidates only; no runtime conflict arbitration or exactly-once guarantee is claimed.'],
      'release_decision':'NO-GO pending private semantic review and faithful integration'}


def main(argv=None):
    p=prep.QuietParser(description=__doc__)
    for arg in ('folder','saved-folder','package'):p.add_argument('--'+arg,type=Path)
    args=p.parse_args(argv)
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        source=args.saved_folder.expanduser() if args.saved_folder else driver.latest(base,r'readonly-\d{8}T\d{6}Z')
        package=args.package.expanduser() if args.package else driver.latest(base,r'followup-review-\d{8}T\d{6}\.\d{6}Z')
        folder=args.folder.expanduser() if args.folder else driver.latest(base,r'followup-readonly-\d{8}T\d{6}\.\d{6}Z')
        _,params=driver.load_package(source,package);prep.private_directory(folder)
        result=analyse(summarise.read_private(source/'catalog-private.json'),
          summarise.read_private(folder/'catalog-followup.PRIVATE.json'),
          summarise.read_private(folder/'report.SANITISED.json'),params)
        print(json.dumps(result,indent=2,sort_keys=True));return 0
    except Exception:
        print('STOP — saved semantic review incompatible or non-private; no raw contents displayed. Database connections: 0',file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
