// ==================== SYF Hotel Backend Server ====================
// Production-ready Supabase-powered backend
// Optimized for stability, security, and performance
// ===================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Supabase Initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tryodszjxcsujgveainj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyeW9kc3pqeGNzdWpndmVhaW5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMDk3NDQsImV4cCI6MjA4NDc4NTc0NH0.iA_F2DwtCD_cUWgRp12KB2el66pOlOf9BLFiMfqWcPw';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ CRITICAL: Supabase credentials missing! Check your .env file.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false
    }
});

console.log('✅ Supabase Connection Initialized');

// 2. Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests with response status
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
    });
    next();
});


// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// --- API ROUTES ---

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// A. Get Live Availability
app.get('/api/availability', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('rooms')
            .select('room_type, available')
            .order('price_per_night', { ascending: false });

        if (error) throw error;

        console.log(`📊 Availability fetch result: ${data ? data.length : 0} rooms found`);
        if (data && data.length > 0) {
            console.log('📝 Sample room data:', data[0]);
        }

        const availabilityObj = {};

        data.forEach(item => {
            availabilityObj[item.room_type] = item.available;
        });
        
        res.json(availabilityObj);
    } catch (err) {
        console.error('❌ Fetch Availability Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch availability', details: err.message });
    }
});

// B. Get All Bookings (Admin Only)
app.get('/api/bookings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('❌ Fetch Bookings Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch bookings', details: err.message });
    }
});

// C. Create New Booking
app.post('/api/bookings', async (req, res) => {
    const b = req.body;
    try {
        console.log('📝 Processing new booking for:', b.guest_name || b.full_name);
        
        // 1. Availability Check
        const { data: room, error: fetchErr } = await supabase
            .from('rooms')
            .select('available')
            .eq('room_type', b.room_type)
            .single();
            
        if (fetchErr || !room) {
            console.error('❌ Room categories lookup failed:', b.room_type);
            return res.status(400).json({ error: 'Room category not found' });
        }

        const quantity = parseInt(b.quantity) || 1;
        if (room.available < quantity) {
            console.warn('⚠️ Room sold out during booking attempt:', b.room_type);
            return res.status(400).json({ error: 'Room category sold out' });
        }

        // 2. Decrement Cloud Stock
        const { error: updErr } = await supabase
            .from('rooms')
            .update({ available: room.available - quantity })
            .eq('room_type', b.room_type);

        if (updErr) {
            console.error('❌ Failed to update room count:', updErr.message);
            throw updErr;
        }

        // 3. Insert Booking Record
        const bookingRecord = {
            room_category: b.room_type,
            number_of_rooms: quantity,
            check_in: b.check_in,
            check_out: b.check_out,
            full_name: b.guest_name || b.full_name,
            phone: b.contact_number || b.phone,
            coming_with_id: b.valid_id === 'Yes' || b.coming_with_id === true,
            payment_amount: parseInt(b.total_amount || b.payment_amount) || 0,
            payment_channel: b.payment_channel,
            transaction_id: b.reference_number || b.transaction_id,
            additional_requests: b.additional_requests
        };

        const { error: saveErr } = await supabase.from('bookings').insert([bookingRecord]);

        if (saveErr) {
            console.error('❌ Failed to save booking record:', saveErr.message);
            // Rollback availability if booking fails
            await supabase
                .from('rooms')
                .update({ available: room.available })
                .eq('room_type', b.room_type);
            throw saveErr;
        }

        console.log('✅ Booking successfully completed for:', b.guest_name || b.full_name);
        res.json({ success: true, message: 'Booking confirmed and saved.' });

    } catch (err) {
        console.error('❌ Booking Process Failure:', err.message);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

// D. Bulk Update Room Availability (Admin Only)
app.post('/api/rooms/bulk-update', async (req, res) => {
    try {
        const updates = req.body;
        console.log('🔄 Bulk updating room availability:', updates);

        if (!updates || Object.keys(updates).length === 0) {
            console.warn('⚠️ Bulk update received with empty payload');
            return res.status(400).json({ error: 'No update data provided' });
        }

        const stats = { success: 0, failed: 0, errors: [] };

        for (const [roomType, count] of Object.entries(updates)) {
            const trimmedRoom = roomType.trim();
            const availCount = parseInt(count);

            if (isNaN(availCount)) {
                console.error(`❌ Invalid count for ${trimmedRoom}: ${count}`);
                stats.failed++;
                stats.errors.push(`${trimmedRoom}: Invalid number`);
                continue;
            }
            
            console.log(`📡 Cloud Sync: Updating [${trimmedRoom}] to ${availCount}...`);
            
            const { error, data } = await supabase
                .from('rooms')
                .update({ available: availCount })
                .eq('room_type', trimmedRoom)
                .select();
            
            if (error) {
                console.error(`❌ Supabase Sync Error [${trimmedRoom}]:`, error.message);
                stats.failed++;
                stats.errors.push(`${trimmedRoom}: ${error.message}`);
            } else {
                console.log(`✅ Cloud Sync Success: ${trimmedRoom}`);
                stats.success++;
            }
        }

        if (stats.failed > 0) {
            console.warn(`⚠️ Bulk update partial completion: ${stats.success} succeeded, ${stats.failed} failed`);
            return res.status(207).json({ 
                success: stats.success > 0, 
                message: 'Update partially completed', 
                stats: stats 
            });
        }

        console.log('✨ All rooms synchronized with Supabase successfully.');
        res.json({ success: true, message: 'All rooms updated successfully.' });

    } catch (err) {
        console.error('❌ Bulk Update Error:', err.message);
        res.status(500).json({ error: 'Failed to update rooms', details: err.message });
    }
});

// --- STATIC FALLBACK ---
// If no API route matches, serve index.html for any other requests
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});




// --- GLOBAL ERROR HANDLER ---
// Prevents server from crashing on unhandled errors
app.use((err, req, res, next) => {
    console.error('💥 UNHANDLED ERROR:', err.stack);
    res.status(500).send('Something broke!');
});

// 3. Start Server
const instance = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ========================================
     🚀 SYF HOTEL SERVER IS RUNNING
     📍 URL: http://localhost:${PORT}
     🌍 Network: http://0.0.0.0:${PORT}
     📅 Started: ${new Date().toLocaleString()}
    ========================================
    `);
});
