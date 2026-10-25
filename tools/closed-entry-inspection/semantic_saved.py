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

SAFE_WORDS=set('return raise exception warning notice info log debug sqlstate and or not is distinct from null true false exists new old tg_op coalesce nullif greatest least select where in as into values set excluded on conflict do nothing update insert delete returning join left right inner outer full lateral case when then else end any all array begin count sum filter over partition by order group having limit offset asc desc found'.split())|classifier.BUILTINS
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
    def __init__(self,tokens,symbols,tables):self.tokens=tokens;self.i=0;self.symbols=symbols;self.tables=tables;self.events=[];self.blocks=[];self.active_blocks=[];self.handlers=[];self.cases=[]
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
    def control_outcome(self,statement):
        if word(statement[0],'return'):
            tail=statement[1:]
            return {'return_expression':tail[0][1] if len(tail)==1 and tail[0] in [('word','new'),('word','old'),('word','null')] else 'other'}
        if word(statement[0],'raise'):
            if len(statement)==1:return {'raise_kind':'bare_reraise'}
            if statement[1][0]=='word' and statement[1][1] in ('debug','log','info','notice','warning'):
                return {'raise_kind':'message_level_not_exception'}
            return {'raise_kind':'new_exception'}
        return {}
    def emit(self,event):
        if len(self.events)>=160:raise Unsupported('event_limit')
        event['block_scope_path']=list(self.active_blocks)
        event['exception_handler_path']=[dict(x) for x in self.handlers]
        self.events.append(event)
    def exception_conditions(self,tokens):
        # PL/pgSQL condition-name or SQLSTATE literal, separated by OR. Do not
        # infer an arbitrary name's class or output private SQLSTATE values.
        i=0;flags={'others':False,'unique_violation':False,'foreign_key_violation':False}
        while i<len(tokens):
            t=tokens[i]
            if word(t,'sqlstate'):
                if i+1>=len(tokens) or tokens[i+1][0]!='literal' or not re.fullmatch(r'[0-9A-Z]{5}',tokens[i+1][1]):raise Unsupported('exception_condition')
                if tokens[i+1][1]=='23505':flags['unique_violation']=True
                if tokens[i+1][1]=='23503':flags['foreign_key_violation']=True
                i+=2
            elif t[0]=='word':
                if t[1] in flags:flags[t[1]]=True
                i+=1
            else:raise Unsupported('exception_condition')
            if i<len(tokens):
                if not word(tokens[i],'or') or i+1==len(tokens):raise Unsupported('exception_condition')
                i+=1
        if not tokens:raise Unsupported('exception_condition')
        return flags
    def block(self,guards,loops):
        if len(self.active_blocks)>=24:raise Unsupported('block_nesting_limit')
        if len(self.blocks)>=64:raise Unsupported('block_count_limit')
        ident=len(self.blocks)+1
        block={'block_number':ident,'parent_block':self.active_blocks[-1] if self.active_blocks else None,'handlers':[]}
        self.blocks.append(block);self.active_blocks.append(ident)
        self.i+=1;start=len(self.events);self.sequence(guards,loops)
        block['protected_event_numbers']=list(range(start+1,len(self.events)+1))
        if self.at('exception'):
            self.i+=1
            if not self.at('when'):raise Unsupported('exception_handler_structure')
            while self.at('when'):
                if len(block['handlers'])>=32:raise Unsupported('handler_count_limit')
                self.i+=1;conditions=self.take('then');flags=self.exception_conditions(conditions)
                number=len(block['handlers'])+1;start=len(self.events)
                handler={'block_number':ident,'handler_number':number}
                self.handlers.append(handler)
                gate={'exception_handler':handler,'conditions':self.symbols.render(conditions),'condition_flags':flags}
                self.sequence(guards+[gate],loops);self.handlers.pop()
                block['handlers'].append({'handler_number':number,'conditions':self.symbols.render(conditions),
                    'condition_flags':flags,'event_numbers':list(range(start+1,len(self.events)+1))})
        if not self.at('end') or self.at('end','if') or self.at('end','loop') or self.at('end','case'):raise Unsupported('block_structure')
        self.i+=1
        if self.i<len(self.tokens) and self.tokens[self.i]==('operator',';'):self.i+=1
        self.active_blocks.pop()
        block['database_changes_in_protected_block_rolled_back_before_matching_handler']=bool(block['handlers'])
        block['plpgsql_local_variables_not_rewound']=bool(block['handlers'])
        for handler in block['handlers']:
            relevant=[self.events[i-1] for i in handler['event_numbers'] if self.events[i-1].get('exception_handler_path',[]) and self.events[i-1]['exception_handler_path'][-1]=={'block_number':ident,'handler_number':handler['handler_number']}]
            outcomes=[e.get('control_outcome_reference',{}) for e in relevant]
            handler['outcome_references_NOT_reachability_proof']={
                'return_new':any(x.get('return_expression')=='new' for x in outcomes),
                'return_old':any(x.get('return_expression')=='old' for x in outcomes),
                'return_null':any(x.get('return_expression')=='null' for x in outcomes),
                'other_return':any(x.get('return_expression')=='other' for x in outcomes),
                'bare_reraise':any(x.get('raise_kind')=='bare_reraise' for x in outcomes),
                'new_exception':any(x.get('raise_kind')=='new_exception' for x in outcomes),
                'message_only_raise':any(x.get('raise_kind')=='message_level_not_exception' for x in outcomes)}
            handler['swallowing_or_error_preservation_verified']=False
        block['handler_effects_and_error_propagation_verified']=False
    def statement_case(self,guards,loops):
        if len(self.cases)>=64:raise Unsupported('case_count_limit')
        self.i+=1;selector=self.take('when');prior=[]
        info={'case_number':len(self.cases)+1,'kind':'simple' if selector else 'searched',
              'selector':self.symbols.render(selector),'has_else':False}
        self.cases.append(info)
        while True:
            if len(prior)>=64:raise Unsupported('case_arm_limit')
            condition=self.take('then')
            gate={'case_number':info['case_number'],'case_selector':self.symbols.render(selector),
                  'when_expression':self.symbols.render(condition),
                  'earlier_whens_not_matched':[self.symbols.render(x) for x in prior],
                  'topics_NOT_effect_proof':topics(selector+condition)}
            self.sequence(guards+[gate],loops);prior.append(condition)
            if self.at('when'):self.i+=1;continue
            break
        if self.at('else'):
            info['has_else']=True;self.i+=1
            self.sequence(guards+[{'case_number':info['case_number'],'no_when_matched':[self.symbols.render(x) for x in prior]}],loops)
        if not self.at('end','case'):raise Unsupported('statement_case_structure')
        self.i+=2
        if self.i>=len(self.tokens) or self.tokens[self.i]!=('operator',';'):raise Unsupported('statement_case_terminator')
        self.i+=1
        info['raises_case_not_found_when_no_match']=not info['has_else']
        if not info['has_else']:
            self.emit({'kind':'control_transfer','symbolic_expression':['IMPLICIT_CASE_NOT_FOUND'],
                'branch_path':guards+[{'case_number':info['case_number'],'no_when_matched':[self.symbols.render(x) for x in prior]}],
                'iteration_context':loops,'topics_NOT_effect_proof':[]})
    def sequence(self,guards,loops):
        if len(guards)+len(loops)>24:raise Unsupported('nesting_limit')
        while self.i<len(self.tokens):
            if self.at('end') or self.at('else') or self.at('elsif') or self.at('exception') or self.at('when'):return
            if self.at('case'):
                self.statement_case(guards,loops);continue
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
                self.block(guards,loops);continue
            statement=self.take(';')
            if not statement:continue
            if any(word(t,'execute') for t in statement):raise Unsupported('dynamic_sql')
            first=statement[0]
            if word(first,'with'):raise Unsupported('cte_requires_review')
            if first[0]=='word' and first[1] in ('insert','update','delete'):
                self.emit(self.write(statement,guards,loops))
            elif ('operator',':=') in statement or word(first,'select') or word(first,'perform') or word(first,'return') or word(first,'raise'):
                self.emit({'kind':'control_transfer' if first[1] in ('return','raise') else 'dataflow_or_control','topics_NOT_effect_proof':topics(statement),
                  'control_outcome_reference':self.control_outcome(statement),
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


def analyse(original,rows,report,params,after_update_only=False):
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
        if after_update_only and (not int(trigger['type_bits'])&16 or int(trigger['type_bits'])&(2|64)):continue
        oid=prep.oid(trigger['function_oid'])
        if trigger.get('definition_body') is not None:remember(oid,trigger['definition_body'])
        item={'trigger_number':len(output)+1,'target_number':next(i for i,t in enumerate(tables,1) if prep.oid(t['table_oid'])==prep.oid(trigger['table_oid'])),
          'insert_event':bool(int(trigger['type_bits'])&4),'update_event':bool(int(trigger['type_bits'])&16),
          'delete_event':bool(int(trigger['type_bits'])&8),'row_level':bool(int(trigger['type_bits'])&1),
          'before':bool(int(trigger['type_bits'])&2),'after':not bool(int(trigger['type_bits'])&(2|64)),'instead_of':bool(int(trigger['type_bits'])&64),
          'enabled_normal_or_always':trigger['enabled'] in ('O','A'),
          'trigger_clause_symbolic':symbols.render(lex(trigger['definition']))}
        review=None
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
              declarations=symbols.render(declarations),events=review.events,
              exception_blocks=review.blocks,statement_cases=review.cases)
        except Unsupported as error:
            # Reasons are exclusively fixed codes created in this module.
            item.update(status='UNSUPPORTED_REQUIRES_PRIVATE_REVIEW',reason=error.args[0])
            if review is not None:
                item['private_review_location']={'body_token_number':review.i+1,'completed_event_count':len(review.events),
                    'block_scope_path':list(review.active_blocks),'exception_handler_path':[dict(x) for x in review.handlers]}
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
      'saved_collection_guards_passed':True,'scope':'AFTER_UPDATE_ONLY' if after_update_only else 'SAVED_TARGET_TRIGGERS','triggers':output,'target_constraints':constraints,
      'limitations':['Symbolic constants hide values; matching symbols mean identical token values, not proven expression equivalence.',
        'Topic matches are references only: they do not prove an award/payment write or legitimate round transition.',
        'Branch paths are lexical nesting, not reachability: preceding returns/raises, loop iterations and helper calls can change execution; review control-event references.',
        'SELECT/RETURN/PERFORM expressions may invoke helpers; this is not a transitive side-effect or PostgreSQL binding proof.',
        'Conflict matches are structural candidates only; no runtime conflict arbitration or exactly-once guarantee is claimed.'],
      'private_review_checklist':['For each exception block, identify protected writes and handler writes separately; handler writes are not rolled back by entering that handler.',
        'Check whether handlers return normally, rethrow or raise a new error, including helper failures; absence of a direct RAISE is not proof of swallowing.',
        'Verify enclosing exception scopes and local variables surviving rollback; check original SQLSTATE privately without sharing it.',
        'For simple CASE, verify selector types, equality/null semantics and WHEN order; for searched CASE verify true/not-true branches.',
        'A statement CASE without ELSE raises CASE_NOT_FOUND on no match; review which enclosing handler can catch it.',
        'Map actual history/payment/League/Trip/payout writes to saved targets, keys, conflict actions, defaults and transaction outcomes before building faithful fixtures.'],
      'release_decision':'NO-GO pending private semantic review and faithful integration'}


def remaining_checks(result):
    triggers=[]
    for trigger in result['triggers']:
        item={'trigger_number':trigger['trigger_number'],'status':trigger['status']}
        if 'reason' in trigger:item['reason']=trigger['reason']
        if 'exception_blocks' in trigger:
            item['exception_scopes']=trigger['exception_blocks']
            item['write_checks']=[{'event_number':i,'operation':e['operation'],
                'target_candidates':e['target_candidates'],'branch_path':e['branch_path'],
                'exception_handler_path':e['exception_handler_path'],'block_scope_path':e['block_scope_path'],
                'conflict':e['conflict'],'reachability_verified':False}
                for i,e in enumerate(trigger['events'],1) if e['kind']=='write']
        triggers.append(item)
    return {'project':result['project'],'database_connections':0,'group_records_read':0,
        'scope':'REMAINING_AFTER_UPDATE_HANDLER_AND_WRITE_CHECKS','triggers':triggers,
        'limitations':result['limitations'],'private_review_checklist':result['private_review_checklist'],
        'release_decision':result['release_decision']}


def main(argv=None):
    p=prep.QuietParser(description=__doc__)
    for arg in ('folder','saved-folder','package'):p.add_argument('--'+arg,type=Path)
    p.add_argument('--after-update-only',action='store_true')
    p.add_argument('--remaining-checks-only',action='store_true')
    args=p.parse_args(argv)
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        source=args.saved_folder.expanduser() if args.saved_folder else driver.latest(base,r'readonly-\d{8}T\d{6}Z')
        package=args.package.expanduser() if args.package else driver.latest(base,r'followup-review-\d{8}T\d{6}\.\d{6}Z')
        folder=args.folder.expanduser() if args.folder else driver.latest(base,r'followup-readonly-\d{8}T\d{6}\.\d{6}Z')
        _,params=driver.load_package(source,package);prep.private_directory(folder)
        result=analyse(summarise.read_private(source/'catalog-private.json'),
          summarise.read_private(folder/'catalog-followup.PRIVATE.json'),
          summarise.read_private(folder/'report.SANITISED.json'),params,after_update_only=args.after_update_only or args.remaining_checks_only)
        if args.remaining_checks_only:result=remaining_checks(result)
        print(json.dumps(result,indent=2,sort_keys=True));return 0
    except Exception:
        print('STOP — saved semantic review incompatible or non-private; no raw contents displayed. Database connections: 0',file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
