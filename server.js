const express = require('express');
const path = require('path');

const app = express();
const PORT = 80;


// Serve static files from the "public" folder
app.use(express.static(__dirname));

// Default route (optional)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running at http://mydomain.com/`);
});