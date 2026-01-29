// ==================== SYF Hotel Production Server ====================
// Optimized for Render.com deployment
// ===================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Supabase Verification & Init
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tryodszjxcsujgveainj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyeW9kc3pqeGNzdWpndmVhaW5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMDk3NDQsImV4cCI6MjA4NDc4NTc0NH0.iA_F2DwtCD_cUWgRp12KB2el66pOlOf9BLFiMfqWcPw';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ CRITICAL ERROR: Supabase Credentials Missing!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Production Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging for Monitoring
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Serve Frontend Files
app.use(express.static(path.join(__dirname)));

// --- API ENDPOINTS ---

// Health Check
app.get('/health', (req, res) => res.json({ status: 'live', time: new Date() }));

// 1. Fetch Availability
app.get('/api/availability', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('rooms')
            .select('room_type, available')
            .order('room_type', { ascending: true });

        if (error) throw error;

        const availMap = {};
        data.forEach(r => availMap[r.room_type] = r.available);
        res.json(availMap);
    } catch (err) {
        console.error('❌ API Error (Availability):', err.message);
        res.status(500).json({ error: 'Database fetch failed' });
    }
});

// 2. Fetch Bookings (Admin Panel)
app.get('/api/bookings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('❌ API Error (Bookings):', err.message);
        res.status(500).json({ error: 'Database fetch failed' });
    }
});

// 3. Submit New Booking
app.post('/api/bookings', async (req, res) => {
    const b = req.body;
    try {
        console.log(`📝 Processing booking: ${b.guest_name}`);

        // Get current room stock
        const { data: room, error: fetchErr } = await supabase
            .from('rooms')
            .select('available')
            .eq('room_type', b.room_type)
            .single();

        if (fetchErr || !room) return res.status(404).json({ error: 'Room type not found' });

        const qty = parseInt(b.quantity) || 1;
        if (room.available < qty) return res.status(400).json({ error: 'Room category sold out' });

        // Update Stock
        const { error: updErr } = await supabase
            .from('rooms')
            .update({ available: room.available - qty })
            .eq('room_type', b.room_type);

        if (updErr) throw updErr;

        // Insert Record - Handles both schema variants (room_category vs room_type)
        const record = {
            full_name: b.guest_name || b.full_name,
            phone: b.contact_number || b.phone,
            room_category: b.room_type, // Primary choice for modern schema
            number_of_rooms: qty,
            check_in: b.check_in,
            check_out: b.check_out,
            payment_amount: parseInt(b.total_amount) || 0,
            payment_channel: b.payment_channel,
            transaction_id: b.reference_number || b.transaction_id,
            coming_with_id: b.valid_id === 'Yes',
            additional_requests: b.additional_requests
        };

        const { error: insErr } = await supabase.from('bookings').insert([record]);
        if (insErr) {
            console.error('❌ Insertion Error:', insErr.message);
            // Rollback
            await supabase.from('rooms').update({ available: room.available }).eq('room_type', b.room_type);
            throw insErr;
        }

        res.json({ success: true, message: 'Booking confirmed' });
    } catch (err) {
        console.error('❌ API Error (Submit Booking):', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

// 4. Admin Bulk Update
app.post('/api/rooms/bulk-update', async (req, res) => {
    const updates = req.body;
    try {
        console.log('🔄 Bulk sync started...');
        const results = { success: [], errors: [] };

        for (const [room, count] of Object.entries(updates)) {
            const { error } = await supabase
                .from('rooms')
                .update({ available: parseInt(count) || 0 })
                .eq('room_type', room.trim());
            
            if (error) results.errors.push(`${room}: ${error.message}`);
            else results.success.push(room);
        }

        if (results.errors.length > 0) {
            return res.status(207).json({ success: results.success.length > 0, errors: results.errors });
        }
        res.json({ success: true, message: 'All rooms synced' });
    } catch (err) {
        console.error('❌ API Error (Bulk Update):', err.message);
        res.status(500).json({ error: 'Sync failed' });
    }
});

// Catch-all: Server UI Router
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SYF HOTEL PROD SERVER: http://0.0.0.0:${PORT}`);
});
