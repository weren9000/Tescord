"""Test-only players exercise complete legal games; no bot feature is shipped."""
from collections import Counter
import random
import unittest

from islands import engine as e
from test_engine import assert_conserved, match


def choose_goal(state, uid):
    hand = e.player(state, uid)['hand']
    if state['deck'] and state['turn'] % 3 == 0:
        return 'development'
    if e.legal_cities(state, uid) and hand['ore'] + hand['grain'] >= 3:
        return 'city'
    if e.legal_settlements(state, uid):
        return 'settlement'
    if e.legal_roads(state, uid) and sum(owner == uid for owner in state['roads'].values()) < 12:
        return 'road'
    if e.legal_cities(state, uid):
        return 'city'
    return 'development'


def road_target(state, uid, choices):
    # Favor an unblocked continuation toward a buildable vertex.
    def value(eid):
        edge = state['board']['edges'][eid]
        result = 0
        for vid in (edge['a'], edge['b']):
            if vid not in state['buildings']:
                result += 1
                if not any(v in state['buildings'] for v in e.neighboring_vertices(state, vid)):
                    result += 3
                result += sum(state['roads'].get(x) != uid for x in state['board']['vertices'][vid]['edges'])
        return result
    return max(choices, key=value)


def decision(state, rng):
    uid = state['active']
    p = e.player(state, uid)
    phase = state['phase']
    actions = e.available_actions(state, uid)
    if phase == 'setup_settlement':
        owned = {e.TERRAINS.get(state['board']['tiles'][int(t)]['terrain']) for vid, b in state['buildings'].items() if b['owner'] == uid for t in state['board']['vertices'][vid]['tiles']}
        def value(vid):
            tiles = [state['board']['tiles'][int(t)] for t in state['board']['vertices'][vid]['tiles']]
            return sum(6-abs(7-t['number']) for t in tiles if t['number']) + 3*len({e.TERRAINS.get(t['terrain']) for t in tiles}-owned)
        return uid, {'type':'setup_settlement','vertex':max(actions['settlements'],key=value)}
    if phase == 'setup_road':
        return uid, {'type':'setup_road','edge':road_target(state,uid,actions['roads'])}
    if phase == 'discard':
        uid = next(iter(state['discard']))
        hand = dict(e.player(state, uid)['hand']); discard = Counter()
        for _ in range(state['discard'][uid]):
            resource = max(hand, key=hand.get); hand[resource] -= 1; discard[resource] += 1
        return uid, {'type':'discard','resources':dict(discard)}
    if phase == 'robber':
        choices = actions['robber_tiles']
        def value(tid):
            tile = state['board']['tiles'][int(tid)]
            return sum((2 if b['owner'] != uid else -5) for vid in tile['vertices'] if (b := state['buildings'].get(vid)))
        return uid, {'type':'move_robber','tile':max(choices,key=value)}
    if phase == 'steal':
        return uid, {'type':'steal','victim':rng.choice(actions['victims'])}
    if phase == 'free_roads':
        return uid, {'type':'build','kind':'road','target':road_target(state,uid,actions['roads'])}
    goal = choose_goal(state, uid)
    cost = e.COSTS[goal]
    for card_id in actions['development']:
        card = next(c for c in p['development'] if c['id'] == card_id)
        command = {'type':'play_development','card':card_id}
        if card['kind'] == 'road_building' and not e.legal_roads(state, uid):
            continue
        if card['kind'] == 'plenty':
            bank = dict(state['bank']); resources = Counter()
            for _ in range(min(2, sum(bank.values()))):
                resource = max((r for r in bank if bank[r]),key=lambda r: cost.get(r,0)-p['hand'][r]-resources[r])
                resources[resource] += 1; bank[resource] -= 1
            if not resources:
                continue
            command['resources'] = dict(resources)
        elif card['kind'] == 'monopoly':
            command['resource'] = max(e.RESOURCES, key=lambda r: sum(other['hand'][r] for other in state['players'] if other['id'] != uid))
        return uid, command
    if phase == 'roll':
        return uid, {'type':'roll'}
    if goal == 'development' and actions['buy_development']:
        return uid, {'type':'buy_development'}
    options = actions.get({'city':'cities','settlement':'settlements','road':'roads'}.get(goal, ''), [])
    if options:
        target = road_target(state,uid,options) if goal == 'road' else options[0]
        return uid, {'type':'build','kind':goal,'target':target}
    # A bank trade only reduces the fixed construction deficit, never swaps back.
    missing = [r for r in cost if p['hand'][r] < cost[r] and state['bank'][r]]
    for resource in e.RESOURCES:
        rate = e.rates(state, uid)[resource]
        if p['hand'][resource] - cost.get(resource,0) >= rate and missing:
            return uid, {'type':'bank_trade','give':{resource:rate},'want':{missing[0]:1}}
    return uid, {'type':'end_turn'}


class FullGameTests(unittest.TestCase):
    def test_complete_three_and_four_player_games_conserve_resources(self):
        for count, seed in ((3, 7), (4, 19), (3, 51), (4, 81)):
            with self.subTest(players=count, seed=seed):
                state, rng = match(seed, count)
                commands = Counter()
                for _ in range(10000):
                    if state['status'] == 'finished':
                        break
                    uid, command = decision(state, rng)
                    commands[command['type']] += 1
                    state = e.apply_command(state, uid, command, rng)
                    assert_conserved(self, state)
                    for p in state['players']:
                        self.assertLessEqual(sum(owner == p['id'] for owner in state['roads'].values()), 15)
                        self.assertLessEqual(e.building_count(state,p['id'],'settlement'),5)
                        self.assertLessEqual(e.building_count(state,p['id'],'city'),4)
                self.assertEqual(state['status'], 'finished', f'No winner after {state["turn"]} turns; commands={commands}')
                self.assertGreaterEqual(e.score(state,state['winner'],True),10)
                self.assertEqual(state['winner'],state['active'])
                for action in ('roll','build','bank_trade','buy_development','play_development','move_robber'):
                    self.assertGreater(commands[action],0, f'{action}: {commands}')


if __name__ == '__main__':
    unittest.main()
