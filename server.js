// ==================== SYF Hotel Backend Server ====================
// Supabase-powered backend for permanent data storage
// Updated schema with rooms and bookings tables
// ===================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
// First try /etc/secrets/supabase.env (for Render), then fall back to .env
dotenv.config({ path: '/etc/secrets/supabase.env' });
if (!process.env.SUPABASE_URL) {
    dotenv.config(); // Fall back to local .env
}

const app = express();
const port = process.env.PORT || 3000;

// ==================== SUPABASE INITIALIZATION ====================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Console logs for testing connection (as requested)
console.log('🔧 Supabase Configuration Check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✓ Loaded' : '✗ Missing');
console.log('---');

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERROR: Supabase credentials not found!');
    console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY in your environment variables');
    console.error('For Render: /etc/secrets/supabase.env');
    console.error('For local: .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase client initialized successfully');

// ==================== MIDDLEWARE ====================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname)));

// ==================== API ROUTES ====================

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'SYF Hotel Backend is running with Supabase! 🚀',
        timestamp: new Date().toISOString(),
        database: 'Supabase (Online Storage)',
        endpoints: {
            rooms: 'GET /api/rooms',
            bookings: 'GET /api/bookings',
            createBooking: 'POST /api/bookings'
        }
    });
});

// ==================== 1. GET ALL ROOMS ====================
// Fetches all room information from Supabase

app.get('/api/rooms', async (req, res) => {
    try {
        console.log('🏨 Fetching all rooms from Supabase...');
        
        const { data, error } = await supabase
            .from('rooms')
            .select('*')
            .order('price_per_night', { ascending: false });

        if (error) {
            console.error('❌ Supabase error:', error);
            throw error;
        }

        console.log(`✅ Retrieved ${data.length} rooms`);
        res.json(data);
        
    } catch (error) {
        console.error('❌ Error fetching rooms:', error);
        res.status(500).json({ 
            error: 'Failed to fetch rooms',
            details: error.message 
        });
    }
});

// ==================== 2. GET ROOM AVAILABILITY ====================
// Legacy endpoint for backward compatibility
// Returns availability in simple object format

app.get('/api/availability', async (req, res) => {
    try {
        console.log('📊 Fetching room availability from Supabase...');
        
        const { data, error } = await supabase
            .from('rooms')
            .select('room_type, available')
            .order('room_type', { ascending: true });

        if (error) {
            console.error('❌ Supabase error:', error);
            throw error;
        }

        // Convert array to object format for frontend compatibility
        const availabilityObj = {};
        data.forEach(item => {
            availabilityObj[item.room_type] = item.available;
        });

        console.log('✅ Availability fetched:', availabilityObj);
        res.json(availabilityObj);
        
    } catch (error) {
        console.error('❌ Error fetching availability:', error);
        res.status(500).json({ 
            error: 'Failed to fetch room availability',
            details: error.message 
        });
    }
});

// ==================== 3. GET ALL BOOKINGS ====================
// Retrieves all bookings from Supabase (for admin dashboard)

app.get('/api/bookings', async (req, res) => {
    try {
        console.log('📋 Fetching all bookings from Supabase...');
        
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ Supabase error:', error);
            throw error;
        }

        console.log(`✅ Retrieved ${data.length} bookings`);
        res.json(data);
        
    } catch (error) {
        console.error('❌ Error fetching bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            details: error.message 
        });
    }
});

// ==================== 4. CREATE NEW BOOKING ====================
// Saves booking to Supabase and decrements room availability atomically

app.post('/api/bookings', async (req, res) => {
    try {
        console.log('📝 New booking request received');
        console.log('Request body:', req.body);

        // Parse booking data from request
        // Support both old and new field names for compatibility
        const booking = {
            room_category: req.body.room_category || req.body['Room Type'] || req.body.room_type || '',
            number_of_rooms: parseInt(req.body.number_of_rooms || req.body['Number of Rooms'] || req.body.quantity || 1),
            check_in: req.body.check_in || req.body['Check In'] || '',
            check_out: req.body.check_out || req.body['Check Out'] || '',
            full_name: req.body.full_name || req.body['Guest Name'] || req.body.guest_name || '',
            phone: req.body.phone || req.body['Guest Phone'] || req.body.contact_number || '',
            coming_with_id: req.body.coming_with_id === true || req.body.coming_with_id === 'true' || 
                           req.body['Valid Id'] === 'Yes' || req.body.valid_id === 'Yes',
            payment_amount: parseInt(req.body.payment_amount || req.body['Payment Amount'] || req.body.total_amount || 0),
            payment_channel: req.body.payment_channel || req.body['Payment Method'] || '',
            transaction_id: req.body.transaction_id || req.body['Reference Number'] || req.body.reference_number || '',
            additional_requests: req.body.additional_requests || req.body['Additional Requests'] || ''
        };

        const roomCategory = booking.room_category;
        const requestedQty = booking.number_of_rooms;

        console.log(`🔍 Checking availability for ${requestedQty}x ${roomCategory}...`);

        // Step 1: Check current availability
        const { data: roomData, error: roomError } = await supabase
            .from('rooms')
            .select('available')
            .eq('room_type', roomCategory)
            .single();

        if (roomError) {
            console.error('❌ Error checking availability:', roomError);
            throw roomError;
        }

        const currentStock = roomData.available;
        console.log(`📊 Current stock for ${roomCategory}: ${currentStock}`);

        // Step 2: Validate availability
        if (currentStock < requestedQty) {
            console.log(`⚠️ Insufficient rooms: requested ${requestedQty}, available ${currentStock}`);
            return res.status(400).json({
                error: `Sorry, not enough rooms available. Only ${currentStock} ${roomCategory}(s) remaining.`
            });
        }

        // Step 3: Decrement availability
        const newStock = currentStock - requestedQty;
        const { error: updateError } = await supabase
            .from('rooms')
            .update({ available: newStock })
            .eq('room_type', roomCategory);

        if (updateError) {
            console.error('❌ Error updating availability:', updateError);
            throw updateError;
        }

        console.log(`✅ Availability updated: ${currentStock} → ${newStock}`);

        // Step 4: Insert booking into database
        const { data: insertedBooking, error: insertError } = await supabase
            .from('bookings')
            .insert([booking])
            .select()
            .single();

        if (insertError) {
            console.error('❌ Error inserting booking:', insertError);
            
            // Rollback: restore availability if booking insert fails
            await supabase
                .from('rooms')
                .update({ available: currentStock })
                .eq('room_type', roomCategory);
                
            throw insertError;
        }

        console.log('✅ Booking saved successfully:', insertedBooking.id);
        
        res.json({ 
            success: true, 
            message: 'Booking confirmed! Your reservation has been saved.',
            booking: insertedBooking,
            remainingRooms: newStock
        });
        
    } catch (error) {
        console.error('❌ Error processing booking:', error);
        res.status(500).json({ 
            error: 'Failed to process booking',
            details: error.message 
        });
    }
});

// ==================== 5. UPDATE ROOM AVAILABILITY (ADMIN) ====================
// Allows manual update of room availability (single room)

app.post('/api/rooms/update-availability', async (req, res) => {
    try {
        console.log('🔄 Updating room availability:', req.body);

        const { room_type, available } = req.body;

        if (!room_type || available === undefined) {
            return res.status(400).json({
                error: 'Missing required fields: room_type and available'
            });
        }

        const { data, error } = await supabase
            .from('rooms')
            .update({ available: parseInt(available) })
            .eq('room_type', room_type)
            .select()
            .single();

        if (error) throw error;

        console.log(`✅ Updated ${room_type} availability to ${available}`);
        res.json({ success: true, room: data });
        
    } catch (error) {
        console.error('❌ Error updating room availability:', error);
        res.status(500).json({ 
            error: 'Failed to update room availability',
            details: error.message 
        });
    }
});

// ==================== 6. BULK UPDATE ROOM AVAILABILITY (ADMIN) ====================
// Updates all room availability at once from admin dashboard

app.post('/api/rooms/bulk-update', async (req, res) => {
    try {
        console.log('🔄 Bulk updating room availability:', req.body);

        const updates = req.body; // Object with room names as keys, availability as values

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({
                error: 'Invalid request body. Expected object with room types and availability.'
            });
        }

        const updatePromises = [];
        
        // Update each room in Supabase
        for (const [roomType, available] of Object.entries(updates)) {
            updatePromises.push(
                supabase
                    .from('rooms')
                    .update({ available: parseInt(available) })
                    .eq('room_type', roomType)
                    .select()
            );
        }

        const results = await Promise.all(updatePromises);
        
        // Check for errors
        const errors = results.filter(r => r.error);
        if (errors.length > 0) {
            console.error('❌ Some updates failed:', errors);
            return res.status(500).json({
                error: 'Some room updates failed',
                details: errors.map(e => e.error.message)
            });
        }

        console.log('✅ All room availability updated successfully');
        res.json({ 
            success: true, 
            message: 'All room availability updated',
            updatedRooms: results.map(r => r.data[0])
        });
        
    } catch (error) {
        console.error('❌ Error in bulk update:', error);
        res.status(500).json({ 
            error: 'Failed to update room availability',
            details: error.message 
        });
    }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /',
            'GET /api/rooms',
            'GET /api/availability',
            'GET /api/bookings',
            'POST /api/bookings',
            'POST /api/rooms/update-availability'
        ]
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        details: err.message 
    });
});

// ==================== START SERVER ====================

app.listen(port, () => {
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('🏨 SYF Hotel Backend Server');
    console.log('═══════════════════════════════════════════════');
    console.log(`✅ Server running on port ${port}`);
    console.log(`🗄️  Database: Supabase (${supabaseUrl})`);
    console.log(`📡 API Endpoints:`);
    console.log(`   - GET  http://localhost:${port}/api/rooms`);
    console.log(`   - GET  http://localhost:${port}/api/availability`);
    console.log(`   - GET  http://localhost:${port}/api/bookings`);
    console.log(`   - POST http://localhost:${port}/api/bookings`);
    console.log(`   - POST http://localhost:${port}/api/rooms/update-availability`);
    console.log('═══════════════════════════════════════════════');
    console.log('');
});
