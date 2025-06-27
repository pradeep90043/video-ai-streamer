import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import dotenv from 'dotenv';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';

// Get the current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Express
const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));



// Parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// Log all requests with body
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} from ${req.headers.origin}`);
  if (req.body) {
    console.log('Request body:', req.body);
  }
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message || 'An unexpected error occurred'
  });
});

// Hugging Face API configuration
const HUGGINGFACE_API_KEY = process.env.HF_TOKEN;
const MODEL_ID = 'google/flan-t5-large'; // Free and powerful model

// Initialize Hugging Face API
const hfApi = axios.create({
  baseURL: 'https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf',
  headers: {
    Authorization: `Bearer ${process.env.HF_TOKEN}`
  }
});

// Function to generate response
const generateResponse = async (prompt) => {
  try {
    const response = await hfApi.post(`/${MODEL_ID}`, {
      inputs: prompt,
      parameters: {
        max_length: 1000,
        temperature: 0.7,
        top_p: 0.9,
        do_sample: true
      }
    });
    return response.data[0].generated_text;
  } catch (error) {
    console.error('Hugging Face API error:', error);
    throw error;
  }
};

// Rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // allow 3 requests per minute
  message: {
    error: "Too many requests",
    details: "Please wait 20 seconds between requests"
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiter to /ask endpoint
app.use('/ask', apiLimiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || origin === 'http://localhost:3000') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Last-Request'],
  exposedHeaders: ['Content-Length'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false,
};

// Transcription endpoint
app.post('/transcribe', async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // For now, just return a placeholder response
    // In a real implementation, you would use a transcription service
    // such as Web Speech API or a similar service
    console.log('Received audio data for transcription');
    
    // Simulate transcription (in a real app, this would be replaced with actual transcription)
    const transcription = 'Transcription completed successfully';
    
    res.json({ transcript: transcription });
  } catch (error) {
    console.error('Error processing transcription:', error);
    res.status(500).json({
      error: 'Failed to process transcription',
      details: error.message
    });
  }
});

// Enable CORS for all routes
app.use(cors(corsOptions));

// Add preflight request handler
app.options('*', cors(corsOptions));

// Log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} from ${req.headers.origin}`);
  next();
});

// Global variables
let globalTranscript = "";

// Basic health check endpoint
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// Download and extract subtitles from a YouTube video
app.post("/upload-url", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'No request body received' });
    }
    
    console.log('Received request:', req.body);
    
    const { videoURL } = req.body;
    if (!videoURL) {
      console.error('No video URL provided');
      return res.status(400).json({ error: 'Video URL is required' });
    }
    
    // Create downloads directory if it doesn't exist
    const downloadsDir = './downloads';
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir);
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const subtitlePath = path.join(downloadsDir, `subtitle_${timestamp}.srt`);
    
    // Download video and extract subtitles using yt-dlp
    console.log('Downloading video and extracting subtitles...');
    const ytDlpCommand = `yt-dlp --write-auto-sub --sub-lang en --sub-format srt --skip-download "${videoURL}" -o "${subtitlePath}"`;
    console.log('Running command:', ytDlpCommand);

    let subtitleText = '';
    await new Promise((resolve, reject) => {
      exec(ytDlpCommand, { shell: '/bin/bash' }, (error, stdout, stderr) => {
        console.log('yt-dlp output:', stdout);
        if (stderr) console.error('yt-dlp error:', stderr);
        if (error) {
          console.error('Error downloading video:', error);
          reject(error);
          return;
        }
        
        // Try to find either SRT or VTT subtitle file
        try {
          const files = fs.readdirSync(downloadsDir);
          const subtitleFile = files.find(file => file.endsWith('.srt') || file.endsWith('.vtt'));
          if (subtitleFile) {
            const subtitlePath = path.join(downloadsDir, subtitleFile);
            subtitleText = fs.readFileSync(subtitlePath, 'utf8');
            console.log('Successfully read subtitle file:', subtitleFile);
            
            // If it's VTT, convert to SRT format
            if (subtitleFile.endsWith('.vtt')) {
              console.log('Converting VTT to SRT format...');
              subtitleText = subtitleText
                .split('\n')
                .filter(line => !line.startsWith('WEBVTT'))
                .filter(line => !line.startsWith('Kind:'))
                .filter(line => !line.startsWith('Language:'))
                .join('\n');
            }
            
            resolve();
          } else {
            console.error('No subtitle file found in directory');
            reject(new Error('No subtitle file found'));
          }
        } catch (err) {
          console.error('Error reading subtitle file:', err);
          reject(err);
        }
      });
    });
    
    // Parse SRT format to extract text
    const transcript = subtitleText.split('\n')
      .filter(line => !line.match(/^\d+$/)) // Remove line numbers
      .filter(line => !line.match(/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/)) // Remove timestamps
      .filter(line => line.trim()) // Remove empty lines
      .join('\n');
    
    console.log('Successfully extracted transcript');
    
    // Clean up downloaded files
    try {
      if (fs.existsSync(subtitlePath)) {
        fs.unlinkSync(subtitlePath);
        console.log('Cleaned up subtitle file');
      }
    } catch (err) {
      console.error('Error cleaning up:', err);
    }

    // Return the transcript
    res.json({
      transcript: transcript,
      success: true
    });
  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({
      error: 'Failed to process video',
      details: error.message
    });
  }
});

// Upload video and generate transcript
app.post("/upload-video", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'No request body received' });
    }
    
    console.log('Received request:', req.body);
    
    const { video } = req.body;
    if (!video) {
      console.error('No video provided');
      return res.status(400).json({ error: 'Video is required' });
    }
    
    // Create downloads directory if it doesn't exist
    const downloadsDir = './downloads';
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir);
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const videoPath = path.join(downloadsDir, `video_${timestamp}.mp4`);
    const audioPath = path.join(downloadsDir, `audio_${timestamp}.wav`);
    const transcriptPath = path.join(downloadsDir, `transcript_${timestamp}.txt`);
    
    // Save video to file
    fs.writeFileSync(videoPath, video);
    
    // Convert video to audio using FFmpeg
    console.log('Converting video to audio...');
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -ab 160k -ac 2 -ar 44100 -vn "${audioPath}"`;
    console.log('Running command:', ffmpegCommand);
    await new Promise((resolve, reject) => {
      exec(ffmpegCommand, { shell: '/bin/bash' }, (error, stdout, stderr) => {
        console.log('FFmpeg output:', stdout);
        if (stderr) console.error('FFmpeg error:', stderr);
        if (error) {
          console.error('Error converting video to audio:', error);
          reject(error);
          return;
        }
        resolve();
      });
    });
    
    // Convert audio to base64
    const wavBuffer = fs.readFileSync(audioPath);
    const audioBase64 = wavBuffer.toString('base64');
    
    // Send to browser for transcription
    const transcriptionResult = await axios.post('http://localhost:3000/transcribe', {
      audio: audioBase64
    });

    const transcript = transcriptionResult.data.transcript;

    // Clean up the WAV file
    fs.unlinkSync(audioPath);
    
    // Save transcript to file
    fs.writeFileSync(transcriptPath, transcript);
    
    // Clean up temporary files
    fs.unlinkSync(videoPath);
    
    // Store transcript globally
    globalTranscript = transcript;
    
    res.json({
      success: true,
      transcript: transcript.text,
      timestamp: timestamp
    });
    
  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({
      error: 'Failed to process video',
      details: error.message
    });
  }
});

// Answer question
app.post("/ask", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'No request body received' });
    }
    
    const { question, timestamp } = req.body;
    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }
    
    // Use current time if timestamp is not provided
    const currentTimestamp = timestamp || Math.floor(Date.now() / 1000);

    const prompt = `
    You're an assistant helping analyze video content. Based on this transcript:
    
    "${globalTranscript}"
    
    At around ${currentTimestamp} seconds, answer the user's question: "${question}"
    `;

    try {
      // Use Hugging Face API
      const answer = await generateResponse(prompt);
      return res.json({ answer: answer.trim() });
    } catch (error) {
      console.error('Hugging Face API error:', error);
      throw error;
    }
  } catch (err) {
    console.error('Error in /ask endpoint:', err);
    res.status(500).json({ error: "Failed to get answer", details: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please stop any other processes using this port.`);
    process.exit(1);
  }
  console.error('Server error:', error);
  process.exit(1);
});
