from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import random
import json
import asyncio
import itertools

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get():
    return FileResponse("static/index.html")

rooms = {}

# --- LÓGICA DE PUNTOS: Incluye la nueva regla del comodín (25 pts) ---
def get_best_points_for_loser(hand):
    def is_valid(group):
        wildcards = sum(1 for c in group if c["comodin"])
        if wildcards > 1: return False
        normals = [c for c in group if not c["comodin"]]
        if not normals: return True
        if all(c["numero"] == normals[0]["numero"] for c in normals): return True
        palo = normals[0]["palo"]
        if not all(c["palo"] == palo for c in normals): return False
        nums = sorted([c["numero"] for c in normals])
        gaps = 0
        for i in range(len(nums) - 1):
            gaps += (nums[i+1] - nums[i] - 1)
        return gaps <= wildcards

    def calculate_score(cards):
        total = 0
        for c in cards:
            if c["comodin"]:
                total += 25
            else:
                total += c["numero"]
        return total

    best_pts = calculate_score(hand)
    
    for r in range(3, 8):
        for combo in itertools.combinations(hand, r):
            if is_valid(combo):
                remaining = [c for c in hand if c not in combo]
                pts = calculate_score(remaining)
                
                for r2 in range(3, len(remaining) + 1):
                    for combo2 in itertools.combinations(remaining, r2):
                        if is_valid(combo2):
                            rem2 = [c for c in remaining if c not in combo2]
                            pts = min(pts, calculate_score(rem2))
                
                best_pts = min(best_pts, pts)
    return best_pts

def create_deck():
    palos = ['Oros', 'Copas', 'Espadas', 'Bastos']
    deck = []
    for palo in palos:
        for numero in range(1, 13):
            is_wildcard = (palo == 'Oros' and numero == 1)
            deck.append({"numero": numero, "palo": palo, "comodin": is_wildcard})
    random.shuffle(deck)
    return deck

async def broadcast_state(room_id):
    if room_id not in rooms: return
    room = rooms[room_id]
    player_names = list(room["players"].keys())
    for name, p_data in room["players"].items():
        state_to_send = {
            "type": "update",
            "my_hand": p_data["hand"],
            "pozo": room["pozo"][-1] if room["pozo"] else None,
            "deck_count": len(room["deck"]),
            "started": room["started"],
            "my_turn": room["started"] and player_names[room["turn"]] == name,
            "scores": {n: d["score"] for n, d in room["players"].items()}
        }
        await p_data["ws"].send_text(json.dumps(state_to_send))

@app.websocket("/ws/{room_id}/{player_name}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_name: str):
    await websocket.accept()
    if room_id not in rooms:
        rooms[room_id] = {"players": {}, "deck": [], "pozo": [], "turn": 0, "started": False}
    room = rooms[room_id]
    
    if len(room["players"]) >= 2:
        await websocket.close()
        return
        
    room["players"][player_name] = {"ws": websocket, "hand": [], "score": 0}
    
    if len(room["players"]) == 2 and not room["started"]:
        await start_new_round(room_id)
        
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            p_names = list(room["players"].keys())
            
            if room["started"] and p_names[room["turn"]] == player_name:
                mano = room["players"][player_name]["hand"]
                
                if msg["type"] == "draw_deck" and len(mano) == 7:
                    if not room["deck"]:
                        if len(room["pozo"]) > 1:
                            last_pozo = room["pozo"].pop()
                            room["deck"] = room["pozo"]
                            random.shuffle(room["deck"])
                            room["pozo"] = [last_pozo]
                    
                    if room["deck"]: 
                        mano.append(room["deck"].pop())
                
                elif msg["type"] == "draw_pozo" and len(mano) == 7:
                    if room["pozo"]: mano.append(room["pozo"].pop())
                
                elif msg["type"] == "discard" and len(mano) == 8:
                    room["pozo"].append(mano.pop(msg["card_idx"]))
                    room["turn"] = (room["turn"] + 1) % 2
                
                elif msg["type"] == "close":
                    room["players"][player_name]["score"] += msg["points"]
                    closer_card = mano.pop(msg["card_idx"])
                    closer_card["boca_abajo"] = True
                    room["pozo"].append(closer_card)
                    
                    round_results = {}
                    for n, p in room["players"].items():
                        if n != player_name:
                            p_round_score = get_best_points_for_loser(p["hand"])
                            p["score"] += p_round_score
                            round_results[n] = p_round_score
                        else:
                            round_results[n] = msg["points"]
                    
                    game_over = any(p["score"] >= 101 for p in room["players"].values())
                    
                    showdown_data = {
                        "type": "showdown",
                        "winner": player_name,
                        "points_type": msg["points"],
                        "round_results": round_results,
                        "all_hands": {n: p["hand"] for n, p in room["players"].items()},
                        "game_over": game_over
                    }
                    
                    for p in room["players"].values():
                        await p["ws"].send_text(json.dumps(showdown_data))
                    
                    await asyncio.sleep(6)
                    
                    if game_over:
                        room["started"] = False
                    else:
                        await start_new_round(room_id)
                        
                await broadcast_state(room_id)
                
    except WebSocketDisconnect:
        if player_name in room["players"]: del room["players"][player_name]
        room["started"] = False

async def start_new_round(room_id):
    room = rooms[room_id]
    room["deck"] = create_deck()
    for p in room["players"].values():
        p["hand"] = [room["deck"].pop() for _ in range(7)]
    room["pozo"] = [room["deck"].pop()]
    room["started"] = True
    await broadcast_state(room_id)
