// Create a Web Speech API service
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

// Configure the recognition
recognition.continuous = false;
recognition.interimResults = false;
recognition.lang = 'en-US';

// Handle errors
recognition.onerror = (event) => {
  console.error('Speech recognition error:', event.error);
};

// Handle results
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  // Send the transcript back to the server
  fetch('/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transcript: transcript })
  });
};

// Export the recognition object
export default recognition;
