/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Wind, 
  Eye, 
  EyeOff, 
  Footprints, 
  RotateCcw, 
  RotateCw, 
  Skull, 
  Timer, 
  Crosshair,
  Zap
} from 'lucide-react';

// --- Constants ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 20;
const ZOMBIE_SIZE = 20;
const BULLET_SPEED = 7;
const ZOMBIE_SPEED = 0.8;
const STEP_DISTANCE = 15;
const BREATH_MAX_TIME = 180; // 3 minutes in seconds
const BLINK_MAX_TIME = 10; // 10 seconds before blur starts
const MAZE_SIZE = 20;
const CELL_SIZE = 100;
const MAGAZINE_CAPACITY = 30;

// --- Types ---
type Point = { x: number; y: number };
type Entity = Point & { angle: number };
type Bullet = Point & { dx: number; dy: number; id: number };
type Zombie = Point & { id: number; health: number };
type MagazinePickup = Point & { id: number };

// --- Maze Generation (Simple DFS) ---
const generateMaze = (width: number, height: number) => {
  const maze = Array.from({ length: height }, () => Array(width).fill(1));
  const stack: [number, number][] = [[1, 1]];
  maze[1][1] = 0;

  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const neighbors = [
      [x + 2, y], [x - 2, y], [x, y + 2], [x, y - 2]
    ].filter(([nx, ny]) => 
      nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && maze[ny][nx] === 1
    );

    if (neighbors.length > 0) {
      const [nx, ny] = neighbors[Math.floor(Math.random() * neighbors.length)];
      maze[ny][nx] = 0;
      maze[y + (ny - y) / 2][x + (nx - x) / 2] = 0;
      stack.push([nx, ny]);
    } else {
      stack.pop();
    }
  }
  return maze;
};

export default function App() {
  const isBlinkingRef = useRef(false);

  // --- Game State (UI only) ---
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start');
  const [uiScore, setUiScore] = useState(0);
  const [uiTime, setUiTime] = useState(0);
  const [uiAmmo, setUiAmmo] = useState(MAGAZINE_CAPACITY);
  const [uiMags, setUiMags] = useState(25);
  const [uiBreath, setUiBreath] = useState(BREATH_MAX_TIME);
  const [uiBlink, setUiBlink] = useState(0);
  const [uiReload, setUiReload] = useState(0);
  const [uiLastStep, setUiLastStep] = useState<'left' | 'right' | null>(null);
  const [uiIsBlinking, setUiIsBlinking] = useState(false);

  // Refs for core game logic (Source of Truth)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Entity>({ x: 150, y: 150, angle: 0 });
  const zombiesRef = useRef<Zombie[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const pickupsRef = useRef<MagazinePickup[]>([]);
  const mazeRef = useRef<number[][]>(generateMaze(MAZE_SIZE, MAZE_SIZE));
  const keysRef = useRef<Record<string, boolean>>({});
  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const nextZombieSpawnRef = useRef<number>(0);
  
  // Logical state refs
  const breathRef = useRef(BREATH_MAX_TIME);
  const blinkRef = useRef(0);
  const ammoRef = useRef(MAGAZINE_CAPACITY);
  const magsRef = useRef(25);
  const reloadRef = useRef(0);
  const lastStepRef = useRef<'left' | 'right' | null>(null);
  const scoreRef = useRef(0);
  const timeRef = useRef(0);
  const gameStateRef = useRef<'start' | 'playing' | 'gameover'>('start');

  // --- Helper: Collision Detection ---
  const isWall = useCallback((x: number, y: number) => {
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    if (cx < 0 || cx >= MAZE_SIZE || cy < 0 || cy >= MAZE_SIZE) return true;
    return mazeRef.current[cy][cx] === 1;
  }, []);

  const checkCircleCollision = (p1: Point, p2: Point, r: number) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy) < r;
  };

  // --- Game Mechanics ---
  const spawnZombie = useCallback(() => {
    let x, y;
    do {
      x = Math.random() * MAZE_SIZE * CELL_SIZE;
      y = Math.random() * MAZE_SIZE * CELL_SIZE;
    } while (isWall(x, y) || checkCircleCollision({ x, y }, playerRef.current, 300));
    
    zombiesRef.current.push({ x, y, id: Math.random(), health: 100 });
  }, [isWall]);

  const spawnPickup = useCallback(() => {
    let x, y;
    do {
      x = Math.random() * MAZE_SIZE * CELL_SIZE;
      y = Math.random() * MAZE_SIZE * CELL_SIZE;
    } while (isWall(x, y));
    pickupsRef.current.push({ x, y, id: Math.random() });
  }, [isWall]);

  const shoot = useCallback(() => {
    const swayFactor = (BREATH_MAX_TIME - breathRef.current) / BREATH_MAX_TIME * 0.1;
    const angle = playerRef.current.angle + (Math.random() - 0.5) * swayFactor;
    bulletsRef.current.push({
      x: playerRef.current.x,
      y: playerRef.current.y,
      dx: Math.cos(angle) * BULLET_SPEED,
      dy: Math.sin(angle) * BULLET_SPEED,
      id: Math.random()
    });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const code = e.code;
    keysRef.current[code] = true;

    if (gameStateRef.current !== 'playing') return;

    // Manual Walking (Layout independent)
    if (code === 'KeyA' || code === 'KeyD') {
      const stepType = code === 'KeyA' ? 'left' : 'right';
      if (lastStepRef.current !== stepType) {
        const nextX = playerRef.current.x + Math.cos(playerRef.current.angle) * STEP_DISTANCE;
        const nextY = playerRef.current.y + Math.sin(playerRef.current.angle) * STEP_DISTANCE;
        if (!isWall(nextX, nextY)) {
          playerRef.current.x = nextX;
          playerRef.current.y = nextY;
          lastStepRef.current = stepType;
        }
      }
    }

    // Manual Breathing
    if (code === 'KeyS') {
      breathRef.current = Math.min(BREATH_MAX_TIME, breathRef.current + 15);
    }

    // Manual Blinking
    if (code === 'KeyW') {
      isBlinkingRef.current = true;
      setUiIsBlinking(true);
      blinkRef.current = 0;
      setTimeout(() => {
        isBlinkingRef.current = false;
        setUiIsBlinking(false);
      }, 150);
    }

    // Manual Reloading (Z-X-C)
    if (code === 'KeyZ') {
      if (reloadRef.current === 0) reloadRef.current = 1;
    }
    if (code === 'KeyX') {
      if (reloadRef.current === 1) reloadRef.current = 2;
    }
    if (code === 'KeyC') {
      if (reloadRef.current === 2) {
        if (magsRef.current > 0) {
          magsRef.current -= 1;
          ammoRef.current = MAGAZINE_CAPACITY;
        }
        reloadRef.current = 0;
      }
    }

    // Shooting
    if (code === 'Space') {
      if (ammoRef.current > 0 && reloadRef.current === 0) {
        shoot();
        ammoRef.current -= 1;
      }
    }
  }, [shoot, isWall]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysRef.current[e.code] = false;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Camera follow
    ctx.save();
    ctx.translate(CANVAS_WIDTH / 2 - playerRef.current.x, CANVAS_HEIGHT / 2 - playerRef.current.y);

    // Draw Floor
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, MAZE_SIZE * CELL_SIZE, MAZE_SIZE * CELL_SIZE);

    // Draw Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= MAZE_SIZE * CELL_SIZE; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, MAZE_SIZE * CELL_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(MAZE_SIZE * CELL_SIZE, i);
      ctx.stroke();
    }

    // Draw Maze Walls
    for (let y = 0; y < MAZE_SIZE; y++) {
      for (let x = 0; x < MAZE_SIZE; x++) {
        if (mazeRef.current[y][x] === 1) {
          // Wall body
          ctx.fillStyle = '#333';
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          // Wall top highlight
          ctx.fillStyle = '#444';
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, 4);
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, 4, CELL_SIZE);
        }
      }
    }

    // Draw Pickups
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#facc15';
    ctx.fillStyle = '#facc15';
    pickupsRef.current.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

    // Draw Zombies
    zombiesRef.current.forEach(z => {
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#ef4444';
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(z.x, z.y, ZOMBIE_SIZE, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Health bar
      ctx.fillStyle = '#000';
      ctx.fillRect(z.x - 15, z.y - 30, 30, 6);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(z.x - 15, z.y - 30, (z.health / 100) * 30, 6);
    });

    // Draw Bullets
    ctx.fillStyle = '#fbbf24';
    bulletsRef.current.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Player
    ctx.save();
    ctx.translate(playerRef.current.x, playerRef.current.y);
    ctx.rotate(playerRef.current.angle);
    
    // Weapon sway based on breathing
    const sway = Math.sin(Date.now() / 200) * (BREATH_MAX_TIME - breathRef.current) / 20;
    ctx.translate(0, sway);

    ctx.shadowBlur = 20;
    ctx.shadowColor = '#3b82f6';
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_SIZE, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    // Gun
    ctx.fillStyle = '#737373';
    ctx.fillRect(10, -5, 25, 10);
    
    ctx.restore();

    // Fog of War / Limited Visibility
    ctx.restore();
    
    const gradient = ctx.createRadialGradient(
      CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 120,
      CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 450
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Blur effect if not blinking
    if (blinkRef.current > BLINK_MAX_TIME) {
      const blurAmount = Math.min(6, (blinkRef.current - BLINK_MAX_TIME) * 1.5);
      canvas.style.filter = `blur(${blurAmount}px) sepia(0.3) hue-rotate(-30deg)`;
    } else {
      canvas.style.filter = 'none';
    }

    // Black out if blinking
    if (isBlinkingRef.current) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, []);

  // --- Game Loop ---
  const update = useCallback((time: number) => {
    if (gameStateRef.current !== 'playing') return;

    const dt = Math.min(0.1, (time - lastTimeRef.current) / 1000);
    lastTimeRef.current = time;

    // Rotation
    if (keysRef.current['KeyQ']) playerRef.current.angle -= 0.05;
    if (keysRef.current['KeyE']) playerRef.current.angle += 0.05;

    // Biological Decay
    breathRef.current -= dt;
    blinkRef.current += dt;
    timeRef.current += dt;

    if (breathRef.current <= 0) {
      gameStateRef.current = 'gameover';
      setGameState('gameover');
    }

    // Spawning
    if (time > nextZombieSpawnRef.current) {
      spawnZombie();
      nextZombieSpawnRef.current = time + Math.max(1000, 5000 - scoreRef.current * 50);
    }
    if (Math.random() < 0.001) spawnPickup();

    // Update Bullets
    bulletsRef.current = bulletsRef.current.filter(b => {
      b.x += b.dx;
      b.y += b.dy;
      if (isWall(b.x, b.y)) return false;
      
      let hit = false;
      zombiesRef.current.forEach(z => {
        if (checkCircleCollision(b, z, ZOMBIE_SIZE)) {
          z.health -= 50;
          hit = true;
        }
      });
      return !hit;
    });

    // Update Zombies
    zombiesRef.current = zombiesRef.current.filter(z => {
      if (z.health <= 0) {
        scoreRef.current += 1;
        return false;
      }
      
      const dx = playerRef.current.x - z.x;
      const dy = playerRef.current.y - z.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < PLAYER_SIZE + ZOMBIE_SIZE) {
        gameStateRef.current = 'gameover';
        setGameState('gameover');
      }

      const angle = Math.atan2(dy, dx);
      const vx = Math.cos(angle) * ZOMBIE_SPEED;
      const vy = Math.sin(angle) * ZOMBIE_SPEED;
      
      // Wall sliding for zombies
      if (!isWall(z.x + vx, z.y + vy)) {
        z.x += vx;
        z.y += vy;
      } else if (!isWall(z.x + vx, z.y)) {
        z.x += vx;
      } else if (!isWall(z.x, z.y + vy)) {
        z.y += vy;
      }
      
      return true;
    });

    // Update Pickups
    pickupsRef.current = pickupsRef.current.filter(p => {
      if (checkCircleCollision(p, playerRef.current, PLAYER_SIZE + 10)) {
        magsRef.current += 1;
        return false;
      }
      return true;
    });

    // Sync UI State (Throttled or every frame)
    setUiScore(scoreRef.current);
    setUiTime(timeRef.current);
    setUiAmmo(ammoRef.current);
    setUiMags(magsRef.current);
    setUiBreath(breathRef.current);
    setUiBlink(blinkRef.current);
    setUiReload(reloadRef.current);
    setUiLastStep(lastStepRef.current);

    draw();
    requestRef.current = requestAnimationFrame(update);
  }, [spawnZombie, spawnPickup, isWall, draw]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [gameState, update]);

  const startGame = () => {
    const initialMaze = generateMaze(MAZE_SIZE, MAZE_SIZE);
    mazeRef.current = initialMaze;
    
    // Find a valid starting position (empty cell)
    let startX = 150;
    let startY = 150;
    let found = false;
    for (let y = 1; y < MAZE_SIZE - 1 && !found; y++) {
      for (let x = 1; x < MAZE_SIZE - 1 && !found; x++) {
        if (initialMaze[y][x] === 0) {
          startX = x * CELL_SIZE + CELL_SIZE / 2;
          startY = y * CELL_SIZE + CELL_SIZE / 2;
          found = true;
        }
      }
    }

    playerRef.current = { x: startX, y: startY, angle: 0 };
    zombiesRef.current = [];
    bulletsRef.current = [];
    pickupsRef.current = [];
    
    scoreRef.current = 0;
    timeRef.current = 0;
    ammoRef.current = MAGAZINE_CAPACITY;
    magsRef.current = 25;
    breathRef.current = BREATH_MAX_TIME;
    blinkRef.current = 0;
    reloadRef.current = 0;
    lastStepRef.current = null;
    
    setUiScore(0);
    setUiTime(0);
    setUiAmmo(MAGAZINE_CAPACITY);
    setUiMags(25);
    setUiBreath(BREATH_MAX_TIME);
    setUiBlink(0);
    setUiReload(0);
    
    lastTimeRef.current = performance.now();
    gameStateRef.current = 'playing';
    setGameState('playing');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 font-sans selection:bg-blue-500/30">
      <div className="relative group">
        {/* Game Header */}
        <div className="absolute -top-12 left-0 right-0 flex justify-between items-end px-2">
          <div className="flex gap-4">
            <div className="flex items-center gap-2 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 px-3 py-1 rounded-full text-sm">
              <Skull className="w-4 h-4 text-red-500" />
              <span className="font-mono font-bold">{uiScore}</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 px-3 py-1 rounded-full text-sm">
              <Timer className="w-4 h-4 text-blue-400" />
              <span className="font-mono">{Math.floor(uiTime)}s</span>
            </div>
          </div>
          <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">
            Manual Survival Protocol
          </div>
        </div>

        {/* Canvas Container */}
        <div className="relative rounded-xl overflow-hidden border-4 border-zinc-800 shadow-2xl shadow-black">
          <canvas 
            ref={canvasRef} 
            width={CANVAS_WIDTH} 
            height={CANVAS_HEIGHT}
            className="bg-zinc-900 cursor-none"
          />

          {/* Overlays */}
          <AnimatePresence>
            {gameState === 'start' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center"
              >
                <motion.h1 
                  initial={{ y: -20 }}
                  animate={{ y: 0 }}
                  className="text-5xl font-black mb-6 bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent"
                >
                  MANUAL SURVIVAL
                </motion.h1>
                <div className="grid grid-cols-2 gap-6 text-left max-w-lg mb-8">
                  <div className="space-y-2">
                    <h3 className="text-blue-400 font-bold text-xs uppercase tracking-tighter">Movement</h3>
                    <p className="text-sm text-zinc-400 flex items-center gap-2"><kbd className="bg-zinc-800 px-1 rounded">A</kbd> Left Foot Step</p>
                    <p className="text-sm text-zinc-400 flex items-center gap-2"><kbd className="bg-zinc-800 px-1 rounded">D</kbd> Right Foot Step</p>
                    <p className="text-sm text-zinc-400 flex items-center gap-2"><kbd className="bg-zinc-800 px-1 rounded">Q</kbd> / <kbd className="bg-zinc-800 px-1 rounded">E</kbd> Rotate Body</p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-red-400 font-bold text-xs uppercase tracking-tighter">Biology</h3>
                    <p className="text-sm text-zinc-400 flex items-center gap-2"><kbd className="bg-zinc-800 px-1 rounded">S</kbd> Breathe (Manual)</p>
                    <p className="text-sm text-zinc-400 flex items-center gap-2"><kbd className="bg-zinc-800 px-1 rounded">W</kbd> Blink (Manual)</p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-yellow-400 font-bold text-xs uppercase tracking-tighter">Combat</h3>
                    <p className="text-sm text-zinc-400 flex items-center gap-2"><kbd className="bg-zinc-800 px-1 rounded">Space</kbd> Fire Weapon</p>
                    <p className="text-sm text-zinc-400 flex items-center gap-2"><kbd className="bg-zinc-800 px-1 rounded">Z</kbd>→<kbd className="bg-zinc-800 px-1 rounded">X</kbd>→<kbd className="bg-zinc-800 px-1 rounded">C</kbd> Reload Sequence</p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-zinc-400 font-bold text-xs uppercase tracking-tighter">Warning</h3>
                    <p className="text-xs text-zinc-500 italic">Failure to breathe for 3 mins is fatal. Failure to blink causes vision degradation.</p>
                  </div>
                </div>
                <button 
                  onClick={startGame}
                  className="group relative px-8 py-4 bg-white text-black font-black rounded-full hover:scale-105 transition-transform active:scale-95 overflow-hidden"
                >
                  <span className="relative z-10">INITIALIZE PROTOCOL</span>
                  <div className="absolute inset-0 bg-blue-500 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                </button>
              </motion.div>
            )}

            {gameState === 'gameover' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 bg-red-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center"
              >
                <Skull className="w-20 h-20 text-red-500 mb-4 animate-bounce" />
                <h2 className="text-6xl font-black mb-2">SYSTEM FAILURE</h2>
                <p className="text-zinc-400 mb-8 max-w-md">
                  Biological functions ceased. You survived for {Math.floor(uiTime)} seconds and eliminated {uiScore} threats.
                </p>
                <button 
                  onClick={startGame}
                  className="px-10 py-4 bg-red-600 hover:bg-red-500 text-white font-black rounded-full transition-colors flex items-center gap-3"
                >
                  <RotateCcw className="w-5 h-5" />
                  REBOOT SYSTEM
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* HUD - Bottom */}
        <div className="mt-6 grid grid-cols-5 gap-3 w-full">
          {/* Breathing */}
          <div className="bg-zinc-900 border border-zinc-800 p-2 rounded-xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-bold text-zinc-500 uppercase">Oxygen</span>
              <Wind className={`w-3 h-3 ${uiBreath < 30 ? 'text-red-500 animate-pulse' : 'text-blue-400'}`} />
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-blue-500"
                animate={{ width: `${(uiBreath / BREATH_MAX_TIME) * 100}%` }}
              />
            </div>
            <div className="mt-1 text-[9px] text-zinc-600 font-mono text-right">
              {Math.floor(uiBreath / 60)}:{(Math.floor(uiBreath % 60)).toString().padStart(2, '0')}
            </div>
          </div>

          {/* Vision */}
          <div className="bg-zinc-900 border border-zinc-800 p-2 rounded-xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-bold text-zinc-500 uppercase">Vision</span>
              {uiBlink > BLINK_MAX_TIME ? <EyeOff className="w-3 h-3 text-red-500" /> : <Eye className="w-3 h-3 text-green-400" />}
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-green-500"
                animate={{ width: `${Math.max(0, 100 - (uiBlink / BLINK_MAX_TIME) * 100)}%` }}
              />
            </div>
            <div className="mt-1 text-[9px] text-zinc-600 font-mono text-right">
              {uiBlink.toFixed(1)}s
            </div>
          </div>

          {/* Ammo */}
          <div className="bg-zinc-900 border border-zinc-800 p-2 rounded-xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-bold text-zinc-500 uppercase">Ammo</span>
              <Crosshair className="w-3 h-3 text-yellow-500" />
            </div>
            <div className="flex items-end gap-1">
              <span className="text-xl font-black leading-none">{uiAmmo}</span>
              <span className="text-[9px] text-zinc-500 font-bold">/ {MAGAZINE_CAPACITY}</span>
            </div>
            <div className="mt-1 text-[9px] text-zinc-600 font-mono">
              MAGS: {uiMags}
            </div>
          </div>

          {/* Reload Status */}
          <div className="bg-zinc-900 border border-zinc-800 p-2 rounded-xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-bold text-zinc-500 uppercase">Reload</span>
              <Zap className={`w-3 h-3 ${uiReload > 0 ? 'text-yellow-400 animate-pulse' : 'text-zinc-700'}`} />
            </div>
            <div className="flex gap-1 justify-center">
              {['Z', 'X', 'C'].map((k, i) => (
                <div 
                  key={k}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black border transition-colors ${
                    uiReload > i ? 'bg-yellow-500 border-yellow-400 text-black' : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                  }`}
                >
                  {k}
                </div>
              ))}
            </div>
          </div>

          {/* Movement Step Hint */}
          <div className="bg-zinc-900 border border-zinc-800 p-2 rounded-xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-bold text-zinc-500 uppercase">Step</span>
              <Footprints className="w-3 h-3 text-purple-400" />
            </div>
            <div className="flex gap-1">
              <div className={`flex-1 py-1 rounded border text-center text-[9px] font-black transition-all ${
                uiLastStep !== 'left' ? 'bg-purple-500 border-purple-400 text-black scale-105 shadow-[0_0_8px_rgba(168,85,247,0.4)]' : 'bg-zinc-800 border-zinc-700 text-zinc-600 opacity-50'
              }`}>
                A
              </div>
              <div className={`flex-1 py-1 rounded border text-center text-[9px] font-black transition-all ${
                uiLastStep !== 'right' ? 'bg-purple-500 border-purple-400 text-black scale-105 shadow-[0_0_8px_rgba(168,85,247,0.4)]' : 'bg-zinc-800 border-zinc-700 text-zinc-600 opacity-50'
              }`}>
                D
              </div>
            </div>
          </div>
        </div>

        {/* Controls Hint */}
        <div className="mt-4 flex justify-center gap-8 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <Footprints className="w-3 h-3" />
            <span>A-D to Walk</span>
          </div>
          <div className="flex items-center gap-2">
            <RotateCcw className="w-3 h-3" />
            <span>Q-E to Turn</span>
          </div>
          <div className="flex items-center gap-2">
            <Wind className="w-3 h-3" />
            <span>S to Breathe</span>
          </div>
          <div className="flex items-center gap-2">
            <Eye className="w-3 h-3" />
            <span>W to Blink</span>
          </div>
        </div>
      </div>
    </div>
  );
}
