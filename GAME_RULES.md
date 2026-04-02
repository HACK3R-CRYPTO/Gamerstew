# Arena Platform - Game Rules & How They Work

## Overview
The Arena Platform supports 4 different game types. Each game has specific rules and win conditions that are properly implemented in the AI agent.

---

## ✊ Game 1: Rock-Paper-Scissors
**Game Type ID:** 0  
**Valid Moves:** 0 (Rock), 1 (Paper), 2 (Scissors)

### How It Works:
1. Both players select their move simultaneously
2. Winner is determined by classic RPS rules:
   - **Rock (0) beats Scissors (2)**
   - **Paper (1) beats Rock (0)**
   - **Scissors (2) beats Paper (1)**
3. If both players choose the same move, **player wins** (tie breaker rule)

---

## 🎲 Game 2: Dice Roll
**Game Type ID:** 1  
**Valid Moves:** 1, 2, 3, 4, 5, 6

### How It Works:
1. Both players select a number (1-6) representing their dice roll
2. **Higher number wins**
3. If both roll the same number, **player wins** (tie breaker rule)

---

## ⚔️ Game 3: Strategy Battle
**Game Type ID:** 2  
**Valid Moves:** 0, 1, 2, 3, 4, 5, 6, 7, 8, 9

### How It Works:
1. Both players select a strategy number (0-9)
2. **Higher number wins**
3. If both choose the same number, **player wins** (tie breaker rule)

---

## 🪙 Game 4: Coin Flip
**Game Type ID:** 3  
**Valid Moves:** 0 (Heads), 1 (Tails)

### How It Works:
1. Both players predict the coin landing (Heads or Tails)
2. A random flip is simulated by the agent
3. **Win Conditions**:
   - If only YOU predict correctly, **you win**
   - If only AI predicts correctly, **AI wins**
   - If BOTH predict correctly, **you win** (tie breaker rule)
   - If BOTH predict wrong, **you win** (tie breaker rule)

---

## 🤝 Universal Tie-Breaker Rules
**The Player Always Wins Ties.** 
In line with our "Player First" philosophy, any situation that would normally result in a draw is automatically awarded to the human challenger. This includes:
- Same moves in RPS
- Equal dice rolls
- Identical strategy choices
- Matching Coin Flip accuracy

## 🤖 Tracking the AI
To verify the AI's moves, watch the terminal logs while playing. You will see:
`🎲 Dice Battle: AI rolled 5, Player rolled 3`
`✅ AI WINS! 5 > 3`
OR
`🤝 TIE! Both rolled 4 → Player wins tie-breaker`
2. **Higher number wins**
3. If both choose the same number, **player wins** (tie breaker)

### AI Strategy:
- Tends to favor high numbers (7-9)
- Adapts based on opponent patterns

**✅ Working as intended** - Simple "higher wins" comparison

---

## 🪙 Game 4: Coin Flip
**Game Type ID:** 3  
**Valid Moves:** 0 (Heads), 1 (Tails)

### How It Works:
1. Both players predict what the coin will land on (Heads or Tails)
2. The AI simulates a **random coin flip** (50/50 chance)
3. The player who **correctly predicted the outcome wins**
4. If both are correct or both are wrong, **player wins** (tie breaker)

### AI Strategy:
- Analyzes opponent's prediction patterns
- Uses statistical probability and pattern exploitation

**✅ Working as intended** - Fair random coin flip with predictions

---

## ❌ Game 5: Tic-Tac-Toe (SIMPLIFIED VERSION)
**Game Type ID:** 4  
**Valid Moves:** 0-8 (grid positions: Top-Left to Bottom-Right)

### How It Currently Works:
⚠️ **This is NOT traditional Tic-Tac-Toe!**

In this simplified version:
1. Both players select ONE cell on the grid simultaneously
2. Winner is determined by **strategic cell value**:
   - **Center (position 4):** Value = 5 points
   - **Corners (0, 2, 6, 8):** Value = 3 points each
   - **Edges (1, 3, 5, 7):** Value = 1 point each
3. **Higher value wins**
4. If values are equal, winner chosen randomly (50/50)

### Why It's Simplified:
- Traditional Tic-Tac-Toe requires turn-based gameplay
- Players alternate placing X and O
- Requires tracking board state between moves
- Winner determined by getting 3-in-a-row

**Current blockchain limitation:** The smart contract doesn't store board state or support multi-turn games within a single match.

### AI Strategy:
- Favors center and corners (higher strategic value)

**⚠️ NOT real Tic-Tac-Toe** - It's a strategic position selection game

---

## 🔥 Recommendation: Should We Keep All 5 Games?

### Games That Work Perfectly (4/5):
✅ **Rock-Paper-Scissors** - Classic rules, working perfectly  
✅ **Dice Roll** - Simple, fair, easy to understand  
✅ **Strategy Battle** - Simple, fair, easy to understand  
✅ **Coin Flip** - Fair random outcome with predictions  

### Game That's Misleading (1/5):
❌ **Tic-Tac-Toe** - NOT real Tic-Tac-Toe, just cell value comparison

### Options:
1. **Keep it with clear warning** - Make it VERY clear it's simplified (already done in UI)
2. **Remove it** - Only show 4 games that work as expected
3. **Implement real Tic-Tac-Toe** - Requires major smart contract changes for multi-turn support

**My recommendation:** Remove Tic-Tac-Toe and focus on the 4 games that work perfectly. This builds trust with users.

---

## Testing Verification

### To verify each game works correctly:

**Rock-Paper-Scissors:**
- Play Rock (should lose to Paper, beat Scissors)
- Play Paper (should lose to Scissors, beat Rock)
- Play Scissors (should lose to Rock, beat Paper)

**Dice Roll:**
- Roll 1 (should lose to 2-6, tie with 1)
- Roll 6 (should beat 1-5, tie with 6)

**Strategy Battle:**
- Choose 0 (should lose to 1-9, tie with 0)
- Choose 9 (should beat 0-8, tie with 9)

**Coin Flip:**
- Predict Heads - watch the AI's log to see actual flip
- Predict Tails - verify winner matches the actual flip

**Tic-Tac-Toe:**
- Choose Center (position 4) - highest value (5 points)
- Choose Corner (0,2,6,8) - medium value (3 points)
- Choose Edge (1,3,5,7) - lowest value (1 point)

---

## Logs to Watch

When playing, check the agent terminal logs to see:
- `Dice Battle: AI rolled X, Player rolled Y`
- `Strategy Battle: AI=X, Player=Y`
- `Coin landed on: Heads/Tails | AI predicted: X, Player predicted: Y`
- `TicTacToe Cell Values: AI Cell X=Value, Player Cell Y=Value`

This proves the game logic is working correctly!
