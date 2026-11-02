import json
import math
import random
import unittest
from copy import deepcopy

from islands import engine as e


def match(seed=17, count=3):
    rng = random.Random(seed)
    state = e.new_lobby('u0', 'Аня')
    for i in range(1, count):
        state['players'].append(e.new_player(f'u{i}', f'Игрок {i}', e.COLORS[i]))
    for p in state['players']:
        p['ready'] = True
    return e.apply_command(state, 'u0', {'type': 'start'}, rng), rng


def finish_setup(state, rng):
    order = []
    while state['phase'].startswith('setup_'):
        uid = state['active']
        if state['phase'] == 'setup_settlement':
            choices = e.legal_settlements(state, uid, True)
            vertex = max(choices, key=lambda vid: len(state['board']['vertices'][vid]['tiles']))
            state = e.apply_command(state, uid, {'type': 'setup_settlement', 'vertex': vertex}, rng)
            order.append(uid)
        else:
            state = e.apply_command(state, uid, {'type': 'setup_road', 'edge': e.legal_roads(state, uid, state['setup_vertex'])[0]}, rng)
    return state, order


def clear_hands(state):
    for p in state['players']:
        e.transfer(p['hand'], state['bank'], dict(p['hand']))


def give(state, uid, resources):
    e.transfer(state['bank'], e.player(state, uid)['hand'], resources)


def assert_conserved(test, state):
    for resource in e.RESOURCES:
        test.assertEqual(state['bank'][resource]+sum(p['hand'][resource] for p in state['players']), 19)
        test.assertTrue(all(p['hand'][resource] >= 0 for p in state['players']))


def find_path(board, length, excluded=()):
    excluded = set(excluded)
    def visit(vid, edge_ids, seen):
        if len(edge_ids) == length:
            return edge_ids, seen
        for eid in board['vertices'][vid]['edges']:
            if eid in excluded or eid in edge_ids:
                continue
            edge = board['edges'][eid]
            other = edge['a'] if edge['b'] == vid else edge['b']
            if other in seen:
                continue
            result = visit(other, edge_ids+[eid], seen+[other])
            if result:
                return result
    for vid in board['vertices']:
        result = visit(vid, [], [vid])
        if result:
            return result
    raise AssertionError('No path found')


class FixedDice(random.Random):
    def __init__(self, a, b):
        super().__init__(3)
        self.values = iter((a, b))
    def randint(self, a, b):
        return next(self.values)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.state, self.rng = match()
        self.state, _ = finish_setup(self.state, self.rng)
        self.uid = self.state['active']

    def test_board_geometry_and_ports(self):
        for seed in range(30):
            board = e.make_board(random.Random(seed))
            self.assertEqual((len(board['tiles']),len(board['vertices']),len(board['edges'])),(19,54,72))
            self.assertEqual(sum(v['port'] is not None for v in board['vertices'].values()),18)
            self.assertEqual(sum(len(edge['tiles']) == 1 for edge in board['edges'].values()),30)
            for edge in board['edges'].values():
                a,b=board['vertices'][edge['a']],board['vertices'][edge['b']]
                self.assertAlmostEqual(math.hypot(a['x']-b['x'],a['y']-b['y']),1,places=5)
                numbers=[board['tiles'][int(t)]['number'] for t in edge['tiles']]
                self.assertFalse(len(numbers)==2 and all(n in (6,8) for n in numbers))

    def test_snake_setup_resources_and_no_wrong_turn(self):
        state,rng=match(count=4)
        expected=[p['id'] for p in state['players']]
        state,order=finish_setup(state,rng)
        self.assertEqual(order,expected+expected[::-1])
        self.assertEqual(state['phase'],'roll')
        self.assertEqual(len(state['buildings']),8)
        self.assertEqual(len(state['roads']),8)
        self.assertTrue(all(e.score(state,p['id'])==2 for p in state['players']))
        self.assertTrue(all(1<=sum(p['hand'].values())<=3 for p in state['players']))
        assert_conserved(self,state)
        original=deepcopy(state)
        with self.assertRaises(e.RuleError):
            e.apply_command(state,expected[1],{'type':'roll'})
        self.assertEqual(state,original)

    def test_resource_production_and_robber(self):
        state=self.state
        clear_hands(state)
        state['buildings']={}
        tile=next(t for t in state['board']['tiles'] if t['terrain']!='desert')
        state['buildings'][tile['vertices'][0]]={'owner':'u0','kind':'settlement'}
        state['buildings'][tile['vertices'][3]]={'owner':'u1','kind':'city'}
        for t in state['board']['tiles']:
            if t['id']!=tile['id']:
                t['number']=None
        resource=e.TERRAINS[tile['terrain']]
        e.production(state,tile['number'])
        self.assertEqual(e.player(state,'u0')['hand'][resource],1)
        self.assertEqual(e.player(state,'u1')['hand'][resource],2)
        state['robber']=tile['id'];before=deepcopy(state['bank']);e.production(state,tile['number'])
        self.assertEqual(state['bank'],before)
        assert_conserved(self,state)

    def test_new_turn_clears_old_dice_including_knight_before_roll(self):
        rolled=e.apply_command(self.state,self.uid,{'type':'roll'},FixedDice(1,1))
        state=e.apply_command(rolled,self.uid,{'type':'end_turn'})
        self.assertEqual(rolled['dice'],[1,1])
        for p in state['players']:
            self.assertIsNone(e.player_view(state,p['id'])['dice'])
        uid=state['active']
        e.player(state,uid)['development']=[{'id':'knight','kind':'knight','bought_turn':0}]
        state=e.apply_command(state,uid,{'type':'play_development','card':'knight'})
        self.assertIsNone(e.player_view(state,uid)['dice'])
        target=next(t['id'] for t in state['board']['tiles'] if t['id']!=state['robber'] and not any(vid in state['buildings'] for vid in t['vertices']))
        state=e.apply_command(state,uid,{'type':'move_robber','tile':target})
        self.assertEqual(state['phase'],'roll')
        state=e.apply_command(state,uid,{'type':'roll'},FixedDice(2,3))
        for p in state['players']:
            self.assertEqual(e.player_view(state,p['id'])['dice'],[2,3])

    def test_bank_shortage_multiple_players_and_single_player_exception(self):
        state=self.state;clear_hands(state);state['buildings']={}
        tile=next(t for t in state['board']['tiles'] if t['terrain']!='desert')
        resource=e.TERRAINS[tile['terrain']]
        for t in state['board']['tiles']:
            if t['id']!=tile['id']:t['number']=None
        state['buildings'][tile['vertices'][0]]={'owner':'u0','kind':'city'}
        state['buildings'][tile['vertices'][3]]={'owner':'u1','kind':'city'}
        give(state,'u2',{resource:16})
        e.production(state,tile['number'])
        self.assertEqual(e.player(state,'u0')['hand'][resource],0)
        self.assertEqual(e.player(state,'u1')['hand'][resource],0)
        del state['buildings'][tile['vertices'][3]]
        give(state,'u2',{resource:2})
        e.production(state,tile['number'])
        self.assertEqual(e.player(state,'u0')['hand'][resource],1)
        self.assertEqual(state['bank'][resource],0)
        assert_conserved(self,state)

    def test_seven_discard_then_robber_and_private_theft(self):
        state=self.state;clear_hands(state);give(state,self.uid,{'wood':9,'ore':2})
        other=next(p['id'] for p in state['players'] if p['id']!=self.uid)
        give(state,other,{'wool':2})
        state=e.apply_command(state,self.uid,{'type':'roll'},FixedDice(3,4))
        self.assertEqual(state['discard'][self.uid],5)
        before=deepcopy(state)
        with self.assertRaises(e.RuleError):e.apply_command(state,self.uid,{'type':'discard','resources':{'wood':4}})
        self.assertEqual(state,before)
        state=e.apply_command(state,self.uid,{'type':'discard','resources':{'wood':5}})
        self.assertEqual(state['phase'],'robber')
        target=next(t for t in state['board']['tiles'] if t['id']!=state['robber'] and any(state['buildings'].get(vid,{}).get('owner')==other for vid in t['vertices']))
        state=e.apply_command(state,self.uid,{'type':'move_robber','tile':target['id']})
        self.assertEqual(state['phase'],'steal')
        state=e.apply_command(state,self.uid,{'type':'steal','victim':other},self.rng)
        self.assertEqual(state['phase'],'main')
        self.assertEqual(e.player(state,self.uid)['hand']['wool'],1)
        self.assertNotIn('wool',state['log'][-1]['text'])
        assert_conserved(self,state)

    def test_legal_building_costs_stock_and_distance(self):
        state=self.state;state['phase']='main';clear_hands(state)
        give(state,self.uid,{'wood':10,'brick':10,'grain':5,'ore':6,'wool':3})
        edge=e.legal_roads(state,self.uid)[0]
        state=e.apply_command(state,self.uid,{'type':'build','kind':'road','target':edge})
        self.assertEqual(e.player(state,self.uid)['hand']['wood'],9)
        self.assertEqual(e.player(state,self.uid)['hand']['brick'],9)
        original=deepcopy(state)
        with self.assertRaises(e.RuleError):e.apply_command(state,self.uid,{'type':'build','kind':'road','target':edge})
        self.assertEqual(state,original)
        own=next(vid for vid,b in state['buildings'].items() if b['owner']==self.uid)
        state=e.apply_command(state,self.uid,{'type':'build','kind':'city','target':own})
        self.assertEqual(state['buildings'][own]['kind'],'city')
        self.assertEqual(e.building_count(state,self.uid,'settlement'),1)
        self.assertEqual(e.player(state,self.uid)['hand']['ore'],3)
        self.assertFalse(set(e.neighboring_vertices(state,own)) & set(e.legal_settlements(state,self.uid)))
        assert_conserved(self,state)

    def test_roads_do_not_pass_through_opponent_buildings(self):
        state=self.state;state['roads']={};state['buildings']={}
        path,vertices=find_path(state['board'],8)
        for eid in path:state['roads'][eid]=self.uid
        self.assertEqual(e.longest_road_length(state,self.uid),8)
        state['buildings'][vertices[4]]={'owner':'u1' if self.uid!='u1' else 'u2','kind':'settlement'}
        self.assertEqual(e.longest_road_length(state,self.uid),4)
        state['buildings'][vertices[4]]['owner']=self.uid
        self.assertEqual(e.longest_road_length(state,self.uid),8)

    def test_awards_retain_incumbent_on_ties(self):
        state=self.state;state['roads']={};state['buildings']={}
        path,_=find_path(state['board'],5)
        second,_=find_path(state['board'],6,path)
        for eid in path:state['roads'][eid]='u0'
        e.update_awards(state);self.assertEqual(state['longest_road'],'u0')
        for eid in second[:5]:state['roads'][eid]='u1'
        e.update_awards(state);self.assertEqual(state['longest_road'],'u0')
        state['roads'][second[5]]='u1';e.update_awards(state)
        self.assertEqual(state['longest_road'],'u1')
        e.player(state,'u0')['knights']=3;e.update_awards(state)
        e.player(state,'u1')['knights']=3;e.update_awards(state)
        self.assertEqual(state['largest_army'],'u0')

    def test_trade_atomicity_and_bank_port_rates(self):
        state=self.state;state['phase']='main';clear_hands(state)
        other=next(p['id'] for p in state['players'] if p['id']!=self.uid)
        give(state,self.uid,{'wood':8});give(state,other,{'ore':3})
        state=e.apply_command(state,self.uid,{'type':'trade_offer','give':{'wood':2},'want':{'ore':1},'target':other})
        offer=state['trade']['id']
        state=e.apply_command(state,other,{'type':'trade_accept','offer':offer})
        self.assertEqual(e.player(state,self.uid)['hand']['ore'],1)
        self.assertEqual(e.player(state,other)['hand']['wood'],2)
        with self.assertRaises(e.RuleError):e.apply_command(state,other,{'type':'trade_accept','offer':offer})
        own=next(vid for vid,b in state['buildings'].items() if b['owner']==self.uid)
        for v in state['board']['vertices'].values():v['port']=None
        self.assertEqual(e.rates(state,self.uid)['wood'],4)
        state['board']['vertices'][own]['port']='any';self.assertEqual(e.rates(state,self.uid)['wood'],3)
        state['board']['vertices'][own]['port']='wood';self.assertEqual(e.rates(state,self.uid)['wood'],2)
        state=e.apply_command(state,self.uid,{'type':'bank_trade','give':{'wood':2},'want':{'grain':1}})
        self.assertEqual(e.player(state,self.uid)['hand']['grain'],1)
        assert_conserved(self,state)

    def test_development_timing_and_monopoly(self):
        state=self.state;clear_hands(state);state['phase']='main'
        give(state,self.uid,{'ore':1,'grain':1,'wool':1});state['deck']=['monopoly']
        state=e.apply_command(state,self.uid,{'type':'buy_development'})
        card=e.player(state,self.uid)['development'][0]
        with self.assertRaises(e.RuleError):e.apply_command(state,self.uid,{'type':'play_development','card':card['id'],'resource':'wood'})
        card['bought_turn']=0
        for p in state['players']:
            if p['id']!=self.uid:give(state,p['id'],{'wood':3})
        state=e.apply_command(state,self.uid,{'type':'play_development','card':card['id'],'resource':'wood'})
        self.assertEqual(e.player(state,self.uid)['hand']['wood'],6)
        self.assertTrue(state['development_played'])
        assert_conserved(self,state)

    def test_knight_before_roll_and_two_free_roads(self):
        state=self.state
        e.player(state,self.uid)['development']=[{'id':'knight','kind':'knight','bought_turn':0}]
        state=e.apply_command(state,self.uid,{'type':'play_development','card':'knight'})
        self.assertEqual(state['return_phase'],'roll')
        target=next(t['id'] for t in state['board']['tiles'] if t['id']!=state['robber'] and not any(vid in state['buildings'] for vid in t['vertices']))
        state=e.apply_command(state,self.uid,{'type':'move_robber','tile':target})
        self.assertEqual(state['phase'],'roll')
        state['development_played']=False
        e.player(state,self.uid)['development']=[{'id':'roads','kind':'road_building','bought_turn':0}]
        before=deepcopy(e.player(state,self.uid)['hand'])
        state=e.apply_command(state,self.uid,{'type':'play_development','card':'roads'})
        for _ in range(2):
            state=e.apply_command(state,self.uid,{'type':'build','kind':'road','target':e.legal_roads(state,self.uid)[0]})
        self.assertEqual(state['phase'],'roll')
        self.assertEqual(e.player(state,self.uid)['hand'],before)

    def test_hidden_cards_are_filtered(self):
        state=self.state
        for p in state['players']:
            p['development']=[{'id':'secret-'+p['id'],'kind':'victory','bought_turn':0}]
        view=e.player_view(state,self.uid)
        self.assertNotIn('deck',view)
        for p in view['players']:
            self.assertNotIn('hand',p);self.assertNotIn('development',p)
            self.assertEqual(p['score'],2)
        self.assertEqual(view['me']['score'],3)
        for other in state['players']:
            if other['id']!=self.uid:self.assertNotIn('secret-'+other['id'],json.dumps(view))

    def test_victory_card_can_win_immediately_when_bought(self):
        state=self.state;state['phase']='main';state['roads']={};state['buildings']={}
        for i,vid in enumerate(list(state['board']['vertices'])[:6]):
            state['buildings'][vid]={'owner':self.uid,'kind':'city' if i<3 else 'settlement'}
        clear_hands(state);give(state,self.uid,{'ore':1,'grain':1,'wool':1});state['deck']=['victory']
        state=e.apply_command(state,self.uid,{'type':'buy_development'})
        self.assertEqual(state['status'],'finished');self.assertEqual(state['winner'],self.uid)

    def test_pause_and_unanimous_abandon(self):
        state=e.apply_command(self.state,self.uid,{'type':'pause'})
        with self.assertRaises(e.RuleError):e.apply_command(state,self.uid,{'type':'roll'})
        state=e.apply_command(state,self.uid,{'type':'resume'})
        for p in state['players']:
            state=e.apply_command(state,p['id'],{'type':'abandon_vote','vote':True})
        self.assertEqual(state['status'],'abandoned')
        self.assertIsNone(state['winner'])


if __name__=='__main__':unittest.main()
