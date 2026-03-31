from random import shuffle, choice


CARDS = {
    'Princess': {
        'count': 1,
        'value': 8,
        },
    'Comtess': {
        'count': 1,
        'value': 7,
    },
    'King': {
        'count': 1,
        'value': 6,
    },
    'Prince': {
        'count': 2,
        'value': 5,
    },
    'Handmaiden': {
        'count': 2,
        'value': 4,
    },
    'Baron': {
        'count': 2,
        'value': 3,
    },
    'Preist': {
        'count': 2,
        'value': 2,
    },
    'Guard': {
        'count': 5,
        'value': 1,
    },
}

class Card:
    def __init__(self, name, value, description=None):
        self.name = name
        self.value = value
        self.description = description

    def __str__(self):
        return "{}".format(self.name)
    
    def __repr__(self):
        return '{}:{}'.format(self.name, self.value)

    def __eq__(self, o):
        return self.value == o.value

class Player:
    def __init__(self, id, hand):
        self.id = id
        self.hand = hand
        self._active = True
        self.points = 0

    def __str__(self):
        return 'Player {}: {}'.format(self.id, self.hand)

    def __eq__(self, o):
        return self.id == o.id

    def pickup(self, new_card):
        if not isinstance(new_card, Card):
            raise ValueError("Player can only pickup Cards")
        self.hand.append(new_card)

    def discard(self, idx):
        return self.hand.pop(idx)

    def print_hand(self):
        print("Player {}'s hand:".format(self.id))
        for card in self.hand:
            print(card)

    @property
    def active(self):
        return self._active

    @active.setter
    def active(self, active_in_round):
        self._active = active_in_round



class Game:
    def __init__(self, num_players=2):
        self.deck = [Card(key, CARDS[key]['value']) for key in CARDS for i in range(CARDS[key]['count'])]
        shuffle(self.deck)
        self.deck.pop(0) # Burn the first card
        self.players = [Player(i, [self.deck.pop(0)]) for i in range(num_players)]
        self.player_order = PlayerOrder(self.players)

    def current_card(self):
        return self.deck[0]

    def current_player(self):
        return self.players[self.player_order.pos]

    def draw(self):
        self.players[self.player_order.pos].pickup(self.deck.pop(0))
        return self.current_player()

    def next(self):
        next(self.player_order)

    def print_deck(self):
        for card in self.deck:
            print(card)

    def discard(self, idx):
        player = self.current_player()
        print('discarding {}'.format(player.hand[idx].name))
        card = player.discard(idx)
        match card.name:
            case 'Princess':
                print('Discarded Princess')
                print('player {} discards the Princess and loses the round'.format(player.id))
                player.active = False
            case 'Comtess':
                print('Discarded Comtess')
            case 'King':
                print('Discarded King')
            case 'Prince':
                print('Discarded Prince')
            case 'Handmaiden':
                print('Discarded Handmaiden')
            case 'Baron':
                print('Discarded Baron')
            case 'Preist':
                print('Discarded Preist')
            case 'Guard':
                print('Discarded Guard')
                self.guard(self.select_player(), self.select_card())
            case _:
                raise ValueError('Unexpected card.')

    def select_card(self):
        selection = input("Select card: ")
        if selection in CARDS.keys():
            c= CARDS[selection]
            return Card(selection, c['value'])
        else:
            raise ValueError("Invalid card")

    def select_player(self):
        if len(self.players) > 2:
            for player in self.players:
                if player != self.current_player():
                    print(player.id)
            selection = input("Select player: ")
            idx = int(selection)
            return self.players[idx]
        else:
            for player in self.players:
                if player != self.current_player():
                    return player

    
    def guard(self, player, card):
        """
        Evaluates the guard discard action.
        Targets player with card. If player has card in their hand, they're out of the round.
        """
        print("checking if {} contains {}".format(player.hand, card))
        for player_card in player.hand:
            print("compare result: {}".format(player_card == card))
            if player_card == card:
                print("Player {}: had {} and is now out of the round".format(player.id, card))
                player.active = False
                return True
        return False
        




        
class PlayerOrder:
    """
    A class to track the player order
    """

    def __init__(self, players):
        self._players = players
        self._pos = 0
        self._reverse = False

    def reverse(self):
        self._reverse = not self._reverse

    @property
    def _delta(self):
        return -1 if self._reverse else 1

    def __next__(self):
        self.pos = self.pos + self._delta
        while not self._players[self._pos].active:
            self.pos = self.pos + self._delta
        return self.pos 
    
    @property
    def pos(self):
        return self._pos

    @pos.setter
    def pos(self, value):
        self._pos = value % len(self._players)

if __name__ == "__main__":
    def print_spacer():
        print('-----')
    game = Game()

    while True:
        player = game.draw()
        print(player)
        player.print_hand()
        idx = int(input("discard: "))
        game.discard(idx)
        print_spacer()
        game.next()

    print('current card: {} ({})'.format(game.current_card().name, game.current_card().value))

    pass
