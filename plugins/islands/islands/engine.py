"""Server-authoritative rules for Islands, ruleset classic-2020-v1.

Pure JSON state. apply_command works on a copy: an invalid command never changes
the persisted match. Production randomness uses SystemRandom; only tests inject
a seeded generator. The internal deck and hands must only leave via player_view.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from functools import lru_cache
import math
import random
import secrets

RESOURCES = ('wood', 'brick', 'wool', 'grain', 'ore')
TERRAINS = {'forest': 'wood', 'hills': 'brick', 'pasture': 'wool', 'fields': 'grain', 'mountains': 'ore'}
COSTS = {'road': {'wood': 1, 'brick': 1}, 'settlement': {'wood': 1, 'brick': 1, 'wool': 1, 'grain': 1}, 'city': {'grain': 2, 'ore': 3}, 'development': {'wool': 1, 'grain': 1, 'ore': 1}}
COLORS = ('amethyst', 'cyan', 'coral', 'gold')
RULESET = 'classic-2020-v1'


class RuleError(ValueError):
    def __init__(self, message: str, code: str = 'invalid_action'):
        super().__init__(message)
        self.code = code


def require(condition, message, code='invalid_action'):
    if not condition:
        raise RuleError(message, code)


def amounts(value, *, allow_empty=False):
    require(isinstance(value, dict) and set(value) <= set(RESOURCES), 'Неизвестный ресурс.')
    require(all(type(n) is int and 0 <= n <= 19 for n in value.values()), 'Некорректное количество ресурсов.')
    result = {key: value.get(key, 0) for key in RESOURCES}
    require(allow_empty or sum(result.values()) > 0, 'Выберите ресурсы.')
    return result


def owns(hand, required):
    return all(hand.get(key, 0) >= count for key, count in required.items())


def transfer(source, destination, resources):
    require(owns(source, resources), 'Недостаточно ресурсов.')
    for key, count in resources.items():
        source[key] -= count
        destination[key] += count


def make_board(rng):
    coordinates = [(q, r) for r in range(-2, 3) for q in range(-2, 3) if abs(q + r) <= 2]
    types = ['forest'] * 4 + ['pasture'] * 4 + ['fields'] * 4 + ['hills'] * 3 + ['mountains'] * 3 + ['desert']
    rng.shuffle(types)
    number_pool = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
    adjacency = lambda a, b: (abs(a[0]-b[0]) + abs(a[1]-b[1]) + abs(a[0]+a[1]-b[0]-b[1])) == 2
    for _ in range(10000):
        rng.shuffle(number_pool)
        numbers = iter(number_pool)
        assigned = [None if terrain == 'desert' else next(numbers) for terrain in types]
        red = [i for i, n in enumerate(assigned) if n in (6, 8)]
        if not any(adjacency(coordinates[a], coordinates[b]) for i, a in enumerate(red) for b in red[i+1:]):
            break
    else:
        raise RuntimeError('Could not generate a valid board')
    vertices, edges, vertex_keys, edge_keys, tiles = {}, {}, {}, {}, []
    for i, ((q, r), terrain, number) in enumerate(zip(coordinates, types, assigned)):
        x, y = math.sqrt(3) * (q + r/2), 1.5 * r
        corners = []
        for side in range(6):
            angle = math.radians(side*60-90)
            key = (round(x+math.cos(angle), 6), round(y+math.sin(angle), 6))
            if key not in vertex_keys:
                vid = str(len(vertices))
                vertex_keys[key] = vid
                vertices[vid] = {'id': vid, 'x': key[0], 'y': key[1], 'tiles': [], 'edges': [], 'port': None}
            vid = vertex_keys[key]
            vertices[vid]['tiles'].append(str(i))
            corners.append(vid)
        tile_edges = []
        for a, b in zip(corners, corners[1:]+corners[:1]):
            key = tuple(sorted((a, b)))
            if key not in edge_keys:
                eid = str(len(edges))
                edge_keys[key] = eid
                edges[eid] = {'id': eid, 'a': a, 'b': b, 'tiles': []}
                vertices[a]['edges'].append(eid)
                vertices[b]['edges'].append(eid)
            eid = edge_keys[key]
            edges[eid]['tiles'].append(str(i))
            tile_edges.append(eid)
        tiles.append({'id': str(i), 'q': q, 'r': r, 'x': x, 'y': y, 'terrain': terrain, 'number': number, 'vertices': corners, 'edges': tile_edges})
    # Walk the coastal cycle so nine ports occupy disjoint pairs of vertices.
    coast = [edge for edge in edges.values() if len(edge['tiles']) == 1]
    coast_by_vertex = defaultdict(list)
    for edge in coast:
        coast_by_vertex[edge['a']].append(edge)
        coast_by_vertex[edge['b']].append(edge)
    current = min(coast_by_vertex, key=int)
    ordered, used = [], set()
    while len(ordered) < len(coast):
        edge = next(edge for edge in coast_by_vertex[current] if edge['id'] not in used)
        used.add(edge['id']); ordered.append(edge)
        current = edge['b'] if edge['a'] == current else edge['a']
    port_types = ['any'] * 4 + list(RESOURCES)
    rng.shuffle(port_types)
    for offset, resource in zip((0, 3, 6, 10, 13, 16, 20, 23, 26), port_types):
        for vid in (ordered[offset]['a'], ordered[offset]['b']):
            vertices[vid]['port'] = resource
    return {'tiles': tiles, 'vertices': vertices, 'edges': edges}


def new_player(user_id, nick, color):
    return {'id': user_id, 'nick': nick[:80], 'color': color, 'ready': False, 'hand': {r: 0 for r in RESOURCES}, 'development': [], 'knights': 0, 'road_length': 0}


def new_lobby(user_id, nick):
    return {'ruleset': RULESET, 'status': 'lobby', 'phase': 'lobby', 'players': [new_player(user_id, nick, COLORS[0])], 'host': user_id, 'active': user_id, 'turn': 0, 'board': None, 'buildings': {}, 'roads': {}, 'bank': {r: 19 for r in RESOURCES}, 'deck': [], 'longest_road': None, 'largest_army': None, 'trade': None, 'log': [], 'winner': None, 'paused_by': None, 'abandon_votes': []}


def player(state, uid):
    result = next((p for p in state['players'] if p['id'] == uid), None)
    require(result is not None, 'Вы не участник этой партии.', 'not_member')
    return result


def log(state, text):
    state['log'].append({'id': state.get('event_number', 0)+1, 'text': text})
    state['event_number'] = state['log'][-1]['id']
    state['log'] = state['log'][-100:]


def neighboring_vertices(state, vid):
    for eid in state['board']['vertices'][vid]['edges']:
        edge = state['board']['edges'][eid]
        yield edge['b'] if edge['a'] == vid else edge['a']


def building_count(state, uid, kind):
    return sum(b['owner'] == uid and b['kind'] == kind for b in state['buildings'].values())


def legal_settlements(state, uid, setup=False):
    if building_count(state, uid, 'settlement') >= 5:
        return []
    result = []
    for vid, vertex in state['board']['vertices'].items():
        if vid in state['buildings'] or any(n in state['buildings'] for n in neighboring_vertices(state, vid)):
            continue
        if setup or any(state['roads'].get(eid) == uid for eid in vertex['edges']):
            result.append(vid)
    return result


def road_connected(state, uid, vid):
    building = state['buildings'].get(vid)
    if building:
        return building['owner'] == uid
    return any(state['roads'].get(eid) == uid for eid in state['board']['vertices'][vid]['edges'])


def legal_roads(state, uid, setup_vertex=None):
    if sum(owner == uid for owner in state['roads'].values()) >= 15:
        return []
    result = []
    for eid, edge in state['board']['edges'].items():
        if eid in state['roads']:
            continue
        if setup_vertex is not None:
            allowed = setup_vertex in (edge['a'], edge['b'])
        else:
            allowed = road_connected(state, uid, edge['a']) or road_connected(state, uid, edge['b'])
        if allowed:
            result.append(eid)
    return result


def legal_cities(state, uid):
    if building_count(state, uid, 'city') >= 4:
        return []
    return [vid for vid, b in state['buildings'].items() if b == {'owner': uid, 'kind': 'settlement'}]


def longest_road_length(state, uid):
    edge_ids = [eid for eid, owner in state['roads'].items() if owner == uid]
    neighbors = defaultdict(list)
    for bit, eid in enumerate(edge_ids):
        edge = state['board']['edges'][eid]
        neighbors[edge['a']].append((edge['b'], 1 << bit))
        neighbors[edge['b']].append((edge['a'], 1 << bit))
    blocked = {vid for vid, b in state['buildings'].items() if b['owner'] != uid}

    @lru_cache(maxsize=None)
    def walk(vid, used):
        if used and vid in blocked:
            return 0
        return max((1+walk(other, used | bit) for other, bit in neighbors[vid] if not used & bit), default=0)

    return max((walk(vid, 0) for vid in neighbors), default=0)


def update_awards(state):
    for p in state['players']:
        p['road_length'] = longest_road_length(state, p['id'])
    for award, field, minimum in (('longest_road', 'road_length', 5), ('largest_army', 'knights', 3)):
        highest = max(p[field] for p in state['players'])
        leaders = [p['id'] for p in state['players'] if p[field] == highest and highest >= minimum]
        old = state[award]
        state[award] = old if old in leaders else leaders[0] if len(leaders) == 1 else None


def score(state, uid, private=False):
    value = sum((2 if b['kind'] == 'city' else 1) for b in state['buildings'].values() if b['owner'] == uid)
    value += 2 * sum(state[award] == uid for award in ('longest_road', 'largest_army'))
    if private:
        value += sum(card['kind'] == 'victory' for card in player(state, uid)['development'])
    return value


def check_victory(state):
    if state['status'] == 'playing' and state['phase'] in ('roll', 'main', 'free_roads') and score(state, state['active'], True) >= 10:
        state['status'] = 'finished'; state['phase'] = 'finished'; state['winner'] = state['active']; state['trade'] = None
        log(state, f"{player(state, state['winner'])['nick']} побеждает!")


def production(state, total):
    claims = {r: Counter() for r in RESOURCES}
    for tile in state['board']['tiles']:
        if tile['id'] == state['robber'] or tile['number'] != total or tile['terrain'] == 'desert':
            continue
        resource = TERRAINS[tile['terrain']]
        for vid in tile['vertices']:
            b = state['buildings'].get(vid)
            if b:
                claims[resource][b['owner']] += 2 if b['kind'] == 'city' else 1
    for resource, demand in claims.items():
        if sum(demand.values()) <= state['bank'][resource]:
            for uid, count in demand.items():
                transfer(state['bank'], player(state, uid)['hand'], {resource: count})
        elif len(demand) == 1:
            transfer(state['bank'], player(state, next(iter(demand)))['hand'], {resource: state['bank'][resource]})


def rates(state, uid):
    ports = {state['board']['vertices'][vid]['port'] for vid, b in state['buildings'].items() if b['owner'] == uid}
    return {r: 2 if r in ports else 3 if 'any' in ports else 4 for r in RESOURCES}


def restore_phase(state):
    state['phase'] = state.pop('return_phase', 'main')
    state.pop('victims', None)


def active_phase(state, uid, phases):
    require(state['status'] == 'playing' and state['active'] == uid and state['phase'] in phases, 'Сейчас это действие недоступно.', 'wrong_phase')


def start_match(state, rng):
    require(3 <= len(state['players']) <= 4, 'Для партии нужны 3–4 игрока.')
    require(all(p['ready'] for p in state['players']), 'Дождитесь готовности всех игроков.')
    rng.shuffle(state['players'])
    state['board'] = make_board(rng)
    state['deck'] = ['knight'] * 14 + ['road_building'] * 2 + ['plenty'] * 2 + ['monopoly'] * 2 + ['victory'] * 5
    rng.shuffle(state['deck'])
    state['status'] = 'playing'; state['phase'] = 'setup_settlement'; state['setup_index'] = 0
    state['setup_order'] = [p['id'] for p in state['players']] + [p['id'] for p in reversed(state['players'])]
    state['active'] = state['setup_order'][0]
    state['robber'] = next(t['id'] for t in state['board']['tiles'] if t['terrain'] == 'desert')
    state['development_played'] = False
    log(state, 'Партия началась. Расставьте первые поселения и дороги.')


def apply_command(original, uid, command, rng=None):
    require(isinstance(command, dict) and isinstance(command.get('type'), str), 'Некорректная команда.')
    rng = rng or random.SystemRandom()
    state = deepcopy(original)
    p = player(state, uid)
    action = command['type']
    require(state['status'] not in ('finished', 'abandoned'), 'Партия завершена.')
    if action == 'ready':
        require(state['status'] == 'lobby' and type(command.get('ready')) is bool, 'Нельзя изменить готовность.')
        p['ready'] = command['ready']
    elif action == 'color':
        color = command.get('color')
        require(state['status'] == 'lobby' and color in COLORS, 'Нельзя выбрать этот цвет.')
        require(not any(other['id'] != uid and other['color'] == color for other in state['players']), 'Этот цвет уже выбран.')
        p['color'] = color; p['ready'] = False
    elif action == 'start':
        require(state['status'] == 'lobby' and state['host'] == uid, 'Начать партию может её создатель.')
        start_match(state, rng)
    elif action == 'pause':
        require(state['status'] == 'playing' and state['paused_by'] is None, 'Партия уже приостановлена.')
        state['paused_by'] = uid; state['trade'] = None; log(state, f"{p['nick']}: партия приостановлена.")
    elif action == 'resume':
        require(state['status'] == 'playing' and state['paused_by'] is not None, 'Партия не приостановлена.')
        require(uid in (state['paused_by'], state['host']), 'Продолжить может автор паузы или создатель партии.')
        state['paused_by'] = None; log(state, f"{p['nick']}: партия продолжена.")
    elif action == 'abandon_vote':
        require(state['status'] == 'playing', 'Партия ещё не началась.')
        require(type(command.get('vote')) is bool, 'Некорректное голосование.')
        state['abandon_votes'] = [v for v in state['abandon_votes'] if v != uid]
        if command['vote']:
            state['abandon_votes'].append(uid)
        if len(state['abandon_votes']) == len(state['players']):
            state['status'] = 'abandoned'; state['phase'] = 'finished'; state['trade'] = None
            log(state, 'Игроки завершили партию без победителя.')
    else:
        require(state['paused_by'] is None, 'Партия на паузе.')
        _play(state, p, action, command, rng)
    if state['board']:
        update_awards(state)
        check_victory(state)
    return state


def _play(state, p, action, command, rng):
    uid = p['id']
    if action == 'setup_settlement':
        active_phase(state, uid, ('setup_settlement',))
        vid = command.get('vertex')
        require(vid in legal_settlements(state, uid, True), 'Здесь нельзя поставить поселение.')
        state['buildings'][vid] = {'owner': uid, 'kind': 'settlement'}
        state['setup_vertex'] = vid; state['phase'] = 'setup_road'
        if state['setup_index'] >= len(state['players']):
            for tid in state['board']['vertices'][vid]['tiles']:
                resource = TERRAINS.get(state['board']['tiles'][int(tid)]['terrain'])
                if resource:
                    transfer(state['bank'], p['hand'], {resource: 1})
        log(state, f"{p['nick']}: начальное поселение построено.")
    elif action == 'setup_road':
        active_phase(state, uid, ('setup_road',))
        eid = command.get('edge')
        require(eid in legal_roads(state, uid, state['setup_vertex']), 'Дорога должна примыкать к новому поселению.')
        state['roads'][eid] = uid; state['setup_index'] += 1
        if state['setup_index'] == len(state['setup_order']):
            state['active'] = state['players'][0]['id']; state['phase'] = 'roll'; state['turn'] = 1
            state.pop('setup_vertex', None)
        else:
            state['active'] = state['setup_order'][state['setup_index']]; state['phase'] = 'setup_settlement'
    elif action == 'roll':
        active_phase(state, uid, ('roll',))
        state['dice'] = [rng.randint(1, 6), rng.randint(1, 6)]
        total = sum(state['dice']); log(state, f"{p['nick']}: кубики {state['dice'][0]} + {state['dice'][1]} = {total}.")
        if total == 7:
            state['discard'] = {other['id']: sum(other['hand'].values()) // 2 for other in state['players'] if sum(other['hand'].values()) > 7}
            state['phase'] = 'discard' if state['discard'] else 'robber'; state['return_phase'] = 'main'
        else:
            production(state, total); state['phase'] = 'main'
    elif action == 'discard':
        require(state['phase'] == 'discard' and uid in state.get('discard', {}), 'Сброс ресурсов не требуется.')
        resources = amounts(command.get('resources'))
        require(sum(resources.values()) == state['discard'][uid], 'Выберите ровно половину карт с округлением вниз.')
        transfer(p['hand'], state['bank'], resources); del state['discard'][uid]
        log(state, f"{p['nick']}: сброс ресурсов — {sum(resources.values())}.")
        if not state['discard']:
            state['phase'] = 'robber'
    elif action == 'move_robber':
        active_phase(state, uid, ('robber',))
        tid = command.get('tile')
        require(isinstance(tid, str) and tid in {t['id'] for t in state['board']['tiles']} and tid != state['robber'], 'Переместите разбойника на другой тайл.')
        state['robber'] = tid
        neighbors = {state['buildings'][vid]['owner'] for vid in state['board']['tiles'][int(tid)]['vertices'] if vid in state['buildings']}
        victims = [other['id'] for other in state['players'] if other['id'] != uid and other['id'] in neighbors and sum(other['hand'].values()) > 0]
        log(state, f"{p['nick']}: разбойник перемещён.")
        if victims:
            state['victims'] = victims; state['phase'] = 'steal'
        else:
            restore_phase(state)
    elif action == 'steal':
        active_phase(state, uid, ('steal',))
        victim_id = command.get('victim')
        require(victim_id in state.get('victims', []), 'Нельзя забрать карту у этого игрока.')
        victim = player(state, victim_id)
        pool = [resource for resource, count in victim['hand'].items() for _ in range(count)]
        require(pool, 'У этого игрока нет ресурсов.')
        transfer(victim['hand'], p['hand'], {rng.choice(pool): 1})
        log(state, f"Кража одной карты: {victim['nick']} → {p['nick']}.")
        restore_phase(state)
    elif action == 'build':
        kind = command.get('kind')
        require(kind in ('road', 'settlement', 'city'), 'Неизвестная постройка.')
        active_phase(state, uid, ('main', 'free_roads'))
        free = state['phase'] == 'free_roads'
        require(not free or kind == 'road', 'Сейчас нужно разместить бесплатную дорогу.')
        target = command.get('target')
        allowed = legal_roads(state, uid) if kind == 'road' else legal_settlements(state, uid) if kind == 'settlement' else legal_cities(state, uid)
        require(target in allowed, 'Здесь нельзя построить выбранный объект.')
        if not free:
            transfer(p['hand'], state['bank'], COSTS[kind])
        if kind == 'road':
            state['roads'][target] = uid
        else:
            state['buildings'][target] = {'owner': uid, 'kind': kind}
        state['trade'] = None
        if free:
            state['free_roads'] -= 1
            if not state['free_roads'] or not legal_roads(state, uid):
                restore_phase(state)
        log(state, f"{p['nick']} строит: " + {'road': 'дорога', 'settlement': 'поселение', 'city': 'город'}[kind] + '.')
    elif action == 'bank_trade':
        active_phase(state, uid, ('main',))
        give, want = amounts(command.get('give')), amounts(command.get('want'))
        require(not any(give[r] and want[r] for r in RESOURCES), 'Обмен должен быть между разными ресурсами.')
        exchange = rates(state, uid)
        require(all(give[r] % exchange[r] == 0 for r in RESOURCES), 'Количество не соответствует курсу обмена.')
        require(sum(give[r] // exchange[r] for r in RESOURCES) == sum(want.values()), 'Проверьте курс обмена.')
        require(owns(state['bank'], want), 'В банке недостаточно выбранных ресурсов.')
        transfer(p['hand'], state['bank'], give); transfer(state['bank'], p['hand'], want)
        state['trade'] = None; log(state, f"{p['nick']}: обмен с банком выполнен.")
    elif action == 'trade_offer':
        active_phase(state, uid, ('main',))
        give, want = amounts(command.get('give')), amounts(command.get('want'))
        require(owns(p['hand'], give), 'Недостаточно ресурсов для предложения.')
        require(not any(give[r] and want[r] for r in RESOURCES), 'В предложении нужны разные ресурсы.')
        target = command.get('target')
        require(target is None or target in [other['id'] for other in state['players'] if other['id'] != uid], 'Неизвестный участник обмена.')
        state['trade'] = {'id': secrets.token_hex(8), 'from': uid, 'to': target, 'give': give, 'want': want, 'declined': []}
    elif action in ('trade_accept', 'trade_decline', 'trade_cancel'):
        require(state['phase'] == 'main' and state['trade'] is not None, 'Предложение уже недоступно.')
        trade = state['trade']
        require(command.get('offer') == trade['id'], 'Предложение изменилось.')
        if action == 'trade_cancel':
            require(uid == trade['from'], 'Отменить предложение может его автор.')
            state['trade'] = None
        else:
            require(uid != trade['from'] and trade['to'] in (None, uid), 'Это предложение предназначено другому игроку.')
            if action == 'trade_decline':
                if uid not in trade['declined']:
                    trade['declined'].append(uid)
            else:
                issuer = player(state, trade['from'])
                require(owns(issuer['hand'], trade['give']) and owns(p['hand'], trade['want']), 'Ресурсов для обмена уже недостаточно.')
                transfer(issuer['hand'], p['hand'], trade['give']); transfer(p['hand'], issuer['hand'], trade['want'])
                state['trade'] = None; log(state, f"{issuer['nick']} и {p['nick']} обменялись ресурсами.")
    elif action == 'buy_development':
        active_phase(state, uid, ('main',))
        require(state['deck'], 'Карты развития закончились.')
        transfer(p['hand'], state['bank'], COSTS['development'])
        p['development'].append({'id': secrets.token_hex(8), 'kind': state['deck'].pop(), 'bought_turn': state['turn']})
        state['trade'] = None; log(state, f"{p['nick']}: карта развития куплена.")
    elif action == 'play_development':
        active_phase(state, uid, ('roll', 'main'))
        require(not state['development_played'], 'За ход можно сыграть одну карту развития.')
        card = next((c for c in p['development'] if c['id'] == command.get('card')), None)
        require(card is not None and card['kind'] != 'victory', 'Эту карту нельзя сыграть.')
        require(card['bought_turn'] < state['turn'], 'Карта доступна со следующего хода.')
        kind = card['kind']
        if kind == 'knight':
            p['knights'] += 1; state['return_phase'] = state['phase']; state['phase'] = 'robber'
        elif kind == 'road_building':
            require(legal_roads(state, uid), 'Нет доступных дорог для строительства.')
            state['free_roads'] = min(2, 15-sum(owner == uid for owner in state['roads'].values()))
            state['return_phase'] = state['phase']; state['phase'] = 'free_roads'
        elif kind == 'plenty':
            resources = amounts(command.get('resources'))
            require(sum(resources.values()) == min(2, sum(state['bank'].values())), 'Выберите два доступных ресурса из банка.')
            transfer(state['bank'], p['hand'], resources)
        elif kind == 'monopoly':
            resource = command.get('resource'); require(resource in RESOURCES, 'Выберите ресурс.')
            for other in state['players']:
                if other['id'] != uid:
                    transfer(other['hand'], p['hand'], {resource: other['hand'][resource]})
        else:
            raise RuleError('Неизвестная карта.')
        p['development'].remove(card); state['development_played'] = True; state['trade'] = None
        log(state, f"{p['nick']}: сыграна карта «" + {'knight': 'Рыцарь', 'road_building': 'Дорожное строительство', 'plenty': 'Изобилие', 'monopoly': 'Монополия'}[kind] + '».')
    elif action == 'end_turn':
        active_phase(state, uid, ('main',))
        index = next(i for i, other in enumerate(state['players']) if other['id'] == uid)
        state['active'] = state['players'][(index+1) % len(state['players'])]['id']
        state['phase'] = 'roll'; state['turn'] += 1; state['development_played'] = False; state['trade'] = None
        state['dice'] = None
    else:
        raise RuleError('Неизвестная команда.')


def available_actions(state, uid):
    p = player(state, uid)
    result = {'roads': [], 'settlements': [], 'cities': [], 'robber_tiles': [], 'victims': [], 'development': [], 'discard': state.get('discard', {}).get(uid, 0), 'roll': False, 'end_turn': False, 'buy_development': False, 'bank_rates': rates(state, uid) if state['board'] else {r: 4 for r in RESOURCES}}
    if state['status'] != 'playing' or state['paused_by'] is not None or state['active'] != uid:
        return result
    phase = state['phase']
    if phase == 'setup_settlement':
        result['settlements'] = legal_settlements(state, uid, True)
    elif phase == 'setup_road':
        result['roads'] = legal_roads(state, uid, state['setup_vertex'])
    elif phase in ('main', 'free_roads'):
        if phase == 'free_roads' or owns(p['hand'], COSTS['road']):
            result['roads'] = legal_roads(state, uid)
        if phase == 'main':
            if owns(p['hand'], COSTS['settlement']):
                result['settlements'] = legal_settlements(state, uid)
            if owns(p['hand'], COSTS['city']):
                result['cities'] = legal_cities(state, uid)
            result['end_turn'] = True
            result['buy_development'] = bool(state['deck']) and owns(p['hand'], COSTS['development'])
    elif phase == 'robber':
        result['robber_tiles'] = [t['id'] for t in state['board']['tiles'] if t['id'] != state['robber']]
    elif phase == 'steal':
        result['victims'] = state['victims'][:]
    result['roll'] = phase == 'roll'
    if phase in ('roll', 'main') and not state['development_played']:
        result['development'] = [c['id'] for c in p['development'] if c['kind'] != 'victory' and c['bought_turn'] < state['turn']]
    return result


def player_view(state, uid):
    me = player(state, uid)
    public_keys = ('ruleset', 'status', 'phase', 'host', 'active', 'turn', 'board', 'buildings', 'roads', 'bank', 'longest_road', 'largest_army', 'trade', 'log', 'winner', 'paused_by', 'abandon_votes', 'dice', 'robber')
    result = {key: deepcopy(state[key]) for key in public_keys if key in state}
    result['players'] = []
    for p in state['players']:
        info = {key: p[key] for key in ('id', 'nick', 'color', 'ready', 'knights', 'road_length')}
        info.update(resource_count=sum(p['hand'].values()), development_count=len(p['development']), score=score(state, p['id'], state['status'] == 'finished'), stock={'road': 15-sum(owner == p['id'] for owner in state['roads'].values()), 'settlement': 5-building_count(state,p['id'],'settlement'), 'city': 4-building_count(state,p['id'],'city')})
        result['players'].append(info)
    result['me'] = {'id': uid, 'hand': deepcopy(me['hand']), 'development': deepcopy(me['development']), 'score': score(state, uid, True)}
    result['deck_count'] = len(state['deck'])
    result['discard_waiting'] = list(state.get('discard', {})) if state['phase'] == 'discard' else []
    result['actions'] = available_actions(state, uid)
    return result
