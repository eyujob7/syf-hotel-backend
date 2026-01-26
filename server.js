const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const AVAILABILITY_FILE = path.join(DATA_DIR, 'availability.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// Ensure data files exist with default values
if (!fs.existsSync(AVAILABILITY_FILE)) {
    const defaultAvailability = {
        "Family Room": 2,
        "Suite Room": 3,
        "Twin Room": 6,
        "Standard Single (Large)": 6,
        "Standard Single (Small)": 8,
        "Standard Room": 14,
        "Single Bed Room": 15
    };
    fs.writeFileSync(AVAILABILITY_FILE, JSON.stringify(defaultAvailability, null, 2));
}

if (!fs.existsSync(BOOKINGS_FILE)) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify([]));
}

// In-Memory Data Store (Optimization)
let availabilityCache = {};
let bookingsCache = [];

// Load data into memory on startup
function loadData() {
    try {
        if (fs.existsSync(AVAILABILITY_FILE)) {
            availabilityCache = JSON.parse(fs.readFileSync(AVAILABILITY_FILE, 'utf8'));
        }
        if (fs.existsSync(BOOKINGS_FILE)) {
            bookingsCache = JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("Error loading initial data:", e);
    }
}
loadData();

// Helper to persist data
function persistAvailability() {
    fs.writeFile(AVAILABILITY_FILE, JSON.stringify(availabilityCache, null, 2), (err) => {
        if (err) console.error("Failed to persist availability:", err);
    });
}
function persistBookings() {
    fs.writeFile(BOOKINGS_FILE, JSON.stringify(bookingsCache, null, 2), (err) => {
        if (err) console.error("Failed to persist bookings:", err);
    });
}

// Multer Config for File Uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'bk_' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

// Routes

// 1. Get Availability (From Memory - Fast)
app.get('/api/availability', (req, res) => {
    res.json(availabilityCache);
});

// 2. Update Availability (Admin / Manual Sync)
app.post('/api/availability', (req, res) => {
    if (req.body.roomType && req.body.quantity !== undefined) {
          // Decrement logic
          const roomType = req.body.roomType;
          const qty = parseInt(req.body.quantity);
          if (availabilityCache[roomType] !== undefined) {
              availabilityCache[roomType] = Math.max(0, availabilityCache[roomType] - qty);
          }
    } else {
        // Full update (Admin override)
        if (req.body["Family Room"] !== undefined) {
             availabilityCache = req.body;
        }
    }
    persistAvailability(); // Async write
    res.json({ success: true, data: availabilityCache });
});

// 3. Get Bookings (From Memory - Fast)
app.get('/api/bookings', (req, res) => {
    res.json(bookingsCache);
});

// 4. Save Booking (Atomic Check & Decrement - Memory Optimized)
app.post('/api/bookings', upload.single('Payment_Screenshot'), (req, res) => {
    const booking = {
        id: 'bk_' + Date.now(),
        timestamp: new Date().toISOString(),
        room_type: req.body['Room Type'] || req.body.room_type || '', 
        quantity: req.body['Number of Rooms'] || req.body.quantity || 1,
        check_in: req.body['Check In'] || req.body.check_in || '',
        check_out: req.body['Check Out'] || req.body.check_out || '',
        guest_name: req.body['Guest Name'] || req.body.guest_name || '',
        contact_number: req.body['Guest Phone'] || req.body.contact_number || '',
        valid_id: req.body['Valid Id'] || req.body.valid_id || '',
        total_amount: req.body['Payment Amount'] || req.body.total_amount || '',
        payment_channel: req.body['Payment Method'] || req.body.payment_channel || '',
        reference_number: req.body['Reference Number'] || req.body.reference_number || '',
        additional_requests: req.body['Additional Requestss'] || req.body.additional_requests || '',
        screenshot_path: req.file ? 'uploads/' + req.file.filename : '' 
    };

    const roomType = booking.room_type;
    const requestedQty = parseInt(booking.quantity);
    
    // Check Stock (In Memory)
    if (availabilityCache[roomType] !== undefined) {
        const currentStock = parseInt(availabilityCache[roomType]);
        if (currentStock < requestedQty) {
            return res.status(400).json({ 
                error: `Sorry, not enough rooms. Only ${currentStock} left for ${roomType}.` 
            });
        }
        // Decrement (In Memory)
        availabilityCache[roomType] = currentStock - requestedQty;
        persistAvailability(); // Persist changes
    }
    
    // Save Booking (In Memory)
    bookingsCache.unshift(booking);
    persistBookings(); // Persist changes

    res.json({ success: true, booking });
});

app.listen(port, () => {
    console.log(`SYF Hotel Backend running at http://localhost:${port}`);
});
