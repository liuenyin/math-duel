import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qmgfcirrgwzcmmyjnecn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZ2ZjaXJyZ3d6Y21teWpuZWNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAzNjY3NCwiZXhwIjoyMDgzNjEyNjc0fQ.0JZ7RnQAauLcI2SZm5SW8AblhN8EgUApPA-8NovLqXw';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== AUTH =====================

export async function registerUser(username, password) {
    if (!username || username.length < 2 || username.length > 20) {
        return { error: '用户名需要2-20个字符' };
    }
    if (!password || password.length < 4) {
        return { error: '密码至少4位' };
    }
    if (/^\[.*\]/.test(username)) {
        return { error: '用户名不能以 [ 开头' };
    }

    const { data: existing } = await supabase
        .from('users').select('username').eq('username', username).single();
    if (existing) {
        return { error: '用户名已被占用' };
    }

    const password_hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from('users').insert({
        username, password_hash, rating: 1500, wins: 0, losses: 0, surrenders: 0, games_played: 0
    });

    if (error) {
        console.error('[DB] registerUser error:', error.message);
        return { error: '注册失败，请重试' };
    }

    // Insert initial rating history point
    await supabase.from('rating_history').insert({
        username, rating: 1500, match_id: null
    });

    return { success: true, user: { username, rating: 1500, wins: 0, losses: 0, surrenders: 0, games_played: 0 } };
}

export async function loginUser(username, password) {
    const { data: user, error } = await supabase
        .from('users').select('*').eq('username', username).single();

    if (error || !user) {
        return { error: '用户名不存在' };
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return { error: '密码错误' };
    }

    const { password_hash, ...safeUser } = user;
    return { success: true, user: safeUser };
}

// ===================== PROFILE =====================

export async function getProfile(username) {
    const { data: user, error } = await supabase
        .from('users')
        .select('username, rating, wins, losses, surrenders, games_played, created_at')
        .eq('username', username).single();

    if (error || !user) return null;

    // Get rating history
    const { data: ratingHistory } = await supabase
        .from('rating_history')
        .select('rating, recorded_at, match_id')
        .eq('username', username)
        .order('recorded_at', { ascending: true })
        .limit(100);

    // Get recent matches involving this user (search in team_a_players / team_b_players)
    const { data: matches } = await supabase
        .from('match_history')
        .select('*')
        .order('ended_at', { ascending: false })
        .limit(200);

    // Filter matches where this user participated
    const userMatches = (matches || []).filter(m => {
        const aPlayers = m.team_a_players || [];
        const bPlayers = m.team_b_players || [];
        return aPlayers.includes(username) || bPlayers.includes(username);
    }).slice(0, 30);

    return {
        ...user,
        ratingHistory: ratingHistory || [],
        recentMatches: userMatches
    };
}

// ===================== ELO =====================

function calculateElo(ratingA, ratingB, scoreA, k = 64) {
    // scoreA: 1 = A wins, 0 = A loses
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    const changeA = Math.round(k * (scoreA - expectedA));
    return changeA;
}

export async function recordMatchResult(roomId, winnerTeam, isSurrender, teamAPlayers, teamBPlayers, teamAScore, teamBScore, dataset) {
    // teamAPlayers / teamBPlayers: [{ name, isRegistered }]
    const registeredA = teamAPlayers.filter(p => p.isRegistered);
    const registeredB = teamBPlayers.filter(p => p.isRegistered);

    // Get current ratings for registered players
    const allRegisteredNames = [...registeredA, ...registeredB].map(p => p.name);
    let ratingsMap = {};

    if (allRegisteredNames.length > 0) {
        const { data: users } = await supabase
            .from('users')
            .select('username, rating')
            .in('username', allRegisteredNames);
        if (users) {
            users.forEach(u => { ratingsMap[u.username] = u.rating; });
        }
    }

    // Calculate average team ratings (only registered players)
    const avgRatingA = registeredA.length > 0
        ? registeredA.reduce((sum, p) => sum + (ratingsMap[p.name] || 1500), 0) / registeredA.length
        : 1500;
    const avgRatingB = registeredB.length > 0
        ? registeredB.reduce((sum, p) => sum + (ratingsMap[p.name] || 1500), 0) / registeredB.length
        : 1500;

    const scoreA = winnerTeam === 'A' ? 1 : 0;
    const eloChange = calculateElo(avgRatingA, avgRatingB, scoreA);

    // Build rating changes object
    const ratingChanges = {};

    for (const p of registeredA) {
        const oldRating = ratingsMap[p.name] || 1500;
        const change = winnerTeam === 'A' ? Math.abs(eloChange) : -Math.abs(eloChange);
        const newRating = Math.max(0, oldRating + change);
        ratingChanges[p.name] = { before: oldRating, after: newRating, change };
    }
    for (const p of registeredB) {
        const oldRating = ratingsMap[p.name] || 1500;
        const change = winnerTeam === 'B' ? Math.abs(eloChange) : -Math.abs(eloChange);
        const newRating = Math.max(0, oldRating + change);
        ratingChanges[p.name] = { before: oldRating, after: newRating, change };
    }

    // Insert match record
    const { data: matchData, error: matchErr } = await supabase.from('match_history').insert({
        room_id: roomId,
        winner_team: winnerTeam,
        is_surrender: isSurrender,
        team_a_players: teamAPlayers.map(p => p.name),
        team_b_players: teamBPlayers.map(p => p.name),
        team_a_score: teamAScore,
        team_b_score: teamBScore,
        dataset: dataset || 'all',
        rating_changes: ratingChanges
    }).select('id').single();

    if (matchErr) {
        console.error('[DB] recordMatchResult insert error:', matchErr.message);
        return;
    }

    const matchId = matchData?.id;

    // Update each registered player's stats and rating
    for (const name of Object.keys(ratingChanges)) {
        const rc = ratingChanges[name];
        const isWinner = (registeredA.some(p => p.name === name) && winnerTeam === 'A') ||
            (registeredB.some(p => p.name === name) && winnerTeam === 'B');
        const isSurrenderLoss = isSurrender && !isWinner;

        // Read current stats, then do a single atomic update
        const { data: currentUser } = await supabase.from('users').select('wins, losses, surrenders, games_played').eq('username', name).single();
        if (currentUser) {
            await supabase.from('users').update({
                rating: rc.after,
                wins: currentUser.wins + (isWinner ? 1 : 0),
                losses: currentUser.losses + (isWinner ? 0 : 1),
                surrenders: currentUser.surrenders + (isSurrenderLoss ? 1 : 0),
                games_played: currentUser.games_played + 1
            }).eq('username', name);
        }

        // Insert rating history point
        if (matchId) {
            await supabase.from('rating_history').insert({
                username: name, rating: rc.after, match_id: matchId
            });
        }
    }

    console.log('[DB] Match recorded:', roomId, 'winner:', winnerTeam, 'ratings:', ratingChanges);
    return ratingChanges;
}

// ===================== ROOM PERSISTENCE =====================

let saveTimers = {};

export async function saveRoom(roomId, roomData) {
    // Debounce: max once per 3 seconds per room
    if (saveTimers[roomId]) return;
    saveTimers[roomId] = true;
    setTimeout(() => { delete saveTimers[roomId]; }, 3000);

    try {
        const { error } = await supabase.from('active_rooms').upsert({
            id: roomId,
            data: roomData,
            updated_at: new Date().toISOString()
        });
        if (error) console.error('[DB] saveRoom error:', error.message);
    } catch (e) {
        console.error('[DB] saveRoom exception:', e.message);
    }
}

export async function loadAllRooms() {
    try {
        const { data, error } = await supabase.from('active_rooms').select('*');
        if (error) {
            console.error('[DB] loadAllRooms error:', error.message);
            return {};
        }
        const rooms = {};
        for (const row of (data || [])) {
            if (row.data && row.data.status !== 'ended') {
                // Mark all players as disconnected (they'll reconnect)
                if (row.data.players) {
                    row.data.players.forEach(p => { p.connected = false; });
                }
                rooms[row.id] = row.data;
            }
        }
        console.log(`[DB] Loaded ${Object.keys(rooms).length} active rooms from database.`);
        return rooms;
    } catch (e) {
        console.error('[DB] loadAllRooms exception:', e.message);
        return {};
    }
}

export async function deleteRoom(roomId) {
    try {
        await supabase.from('active_rooms').delete().eq('id', roomId);
    } catch (e) {
        console.error('[DB] deleteRoom exception:', e.message);
    }
}

// Force-save immediately (bypass debounce)
export async function saveRoomImmediate(roomId, roomData) {
    delete saveTimers[roomId];
    try {
        await supabase.from('active_rooms').upsert({
            id: roomId,
            data: roomData,
            updated_at: new Date().toISOString()
        });
    } catch (e) {
        console.error('[DB] saveRoomImmediate exception:', e.message);
    }
}

// ===================== RECENT MATCHES (for lobby) =====================

export async function getRecentMatches(limit = 10) {
    const { data, error } = await supabase
        .from('match_history')
        .select('*')
        .order('ended_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[DB] getRecentMatches error:', error.message);
        return [];
    }
    return data || [];
}
