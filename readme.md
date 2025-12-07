# AI Workout Tracker – Ionic Angular + Firebase

This repository contains the frontend + backend setup for the AI Workout Tracker mobile/web application.  
The project is built with **Ionic Angular (Standalone Components)** and uses **Firebase** as the backend for authentication, database, storage, and cloud functions.

This README describes how to clone, set up, run, and develop the project on both **macOS** and **Windows**.

---

# 📦 Tech Stack

### **Frontend**
- Ionic 7 (Angular)
- Angular Standalone Architecture (no NgModules)
- TypeScript
- Capacitor (optional)

### **Backend**
- Firebase Authentication  
- Firestore Database  
- Firebase Storage  
- Firebase Cloud Functions (Node.js)

### **Tooling**
- Node.js 22
- Ionic CLI
- Firebase CLI

---

#  Getting Started

## 1. Clone the Repository

```bash
git clone https://github.com/david-rd-iee/ai-workout-tracker.git
cd ai-workout-tracker
```


## 2. Install Tools

### Node.js (use Node 22)

#### macOS → install with nvm

```bash
nvm install 22
nvm use 22
```

#### Windows → install with nvm-windows or the Node 22 installer
```bash
install nvm-windows
run: nvm install 22 && nvm use 22
```

### Install Ionic CLI and Firebase CLI
```bash
npm install firebase @angular/fire

npm install -g @ionic/cli firebase-tools
```

#### go to src/environments

Add envirornment.ts and enviroment.prod.ts, copy and paste from the discord

#### In root
create .env and .env.dev, copy and paste from .example.env and add paste in all info

## 3. Dependencies
```bash
npm install
```

### For FireBase as well
```bash
cd functions
npm i
cd ..
```

#### Deploying, for later
```bash
# from repo root
firebase deploy --only firestore:rules
cd functions && npm run deploy prod:all
# or
firebase deploy --only functions
```

## Test on machine
```bash
ionic serve --stage
```

### Testing Leaderboard, Client Profile, and Workout Summary Pages
Navigate to the three different pages with correct hosting port

```bash
http://localhost:8100/leaderboard
http://localhost:8100/workout-summary
http://localhost:8100/client-profile
```