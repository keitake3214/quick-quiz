// hooks/useQuizApp.ts
import { useState, useEffect, useRef } from "react";
import { db, auth, signInAnonymously } from "../lib/firebase";
import { ref, onValue, set, update, get, remove, onDisconnect, runTransaction } from "firebase/database";

// --- 型定義 ---
export type AppState = {
  mode: "registration" | "countdown" | "execution" | "result" | "finalResult";
  timeLimit: number;
  finalTransitionDelay: number;
  rankingDisplayTime: number;
  currentQuestionId: string | null;
  currentQuestionText?: string;
  questionStartTime: number;
  askedQuestions?: Record<string, boolean>;
  countdownStartTime?: number;
};

export type Question = {
  text: string;
  choices: string[];
  correctIndex: number;
};

export type UserData = {
  score: number;
  totalTimeTaken: number;
  isOnline?: boolean;
  isReady?: boolean;
  lineUserId?: string;
  displayName?: string;
  pictureUrl?: string;
};

export type AnswerData = {
  choice: number;
  timeTaken: number;
  pointsEarned?: number;
};

export type LineProfile = {
  userId: string;
  displayName: string;
  pictureUrl: string;
};

export type ResultPhase = "idle" | "showCorrect" | "showRanking" | "showFinalCountdown";

// --- バックエンドロジチE��本佁E---
export function useQuizApp() {
  const [lineProfile, setLineProfile] = useState<LineProfile | null>(null);
  const [userName, setUserName] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isRoomHost, setIsRoomHost] = useState(false);
  const [roomInput, setRoomInput] = useState("");
  const [activeRooms, setActiveRooms] = useState<string[]>([]);

  const [appState, setAppState] = useState<AppState>({
    mode: "registration",
    timeLimit: 20,
    finalTransitionDelay: 5,
    rankingDisplayTime: 5,
    currentQuestionId: null,
    questionStartTime: 0,
    askedQuestions: {},
  });
  const [questions, setQuestions] = useState<Record<string, Question>>({});
  const [users, setUsers] = useState<Record<string, UserData>>({});
  const [currentAnswers, setCurrentAnswers] = useState<Record<string, AnswerData>>({});

  const [myQuestion, setMyQuestion] = useState<Question>({
    text: "",
    choices: ["", "", "", ""],
    correctIndex: 0,
  });
  const [timeLeft, setTimeLeft] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const [showReadyScreen, setShowReadyScreen] = useState(false);

  const [sortedResults, setSortedResults] = useState<any[]>([]);
  const [resultPhase, setResultPhase] = useState<ResultPhase>("idle");
  const [resultRevealIndex, setResultRevealIndex] = useState(0);
  const [finalCountdown, setFinalCountdown] = useState(5);

  const [finalRevealIndex, setFinalRevealIndex] = useState(0);
  const [sortedFinalResults, setSortedFinalResults] = useState<any[]>([]);
  const finalInitRef = useRef(false);
  const autoLoginProcessed = useRef(false);

  // --- BGM ---
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      audioRef.current = new Audio("/bgm.mp3");
      audioRef.current.loop = true;
    }
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    if (appState.mode === "execution" && timeLeft > 0) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [appState.mode, timeLeft]);

  // --- 進行状況�E計箁E---
  const totalQuestions = Object.keys(questions || {}).length;
  const askedCount = appState.askedQuestions ? Object.keys(appState.askedQuestions).length : 0;
  const isLastQuestion = totalQuestions > 0 && askedCount >= totalQuestions;

  // --- LINEプロフィールをCookieから読み込む ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cookies = document.cookie.split(";").reduce((acc, c) => {
      const [k, v] = c.trim().split("=");
      acc[k] = v;
      return acc;
    }, {} as Record<string, string>);
    if (cookies["line_user"]) {
      try {
        const profile: LineProfile = JSON.parse(decodeURIComponent(cookies["line_user"]));
        setLineProfile(profile);
      } catch { /* ignore */ }
    }
  }, []);

  // --- FirebaseチE�Eタ購読 & 自動ログインチェチE�� ---
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    // 自動ログイン復允E��ルームIDも復允E��E
    if (!autoLoginProcessed.current) {
      autoLoginProcessed.current = true;
      const savedName = localStorage.getItem("quick_quiz_user_name");
      const savedRoom = localStorage.getItem("quick_quiz_room_id");
      const savedHost = localStorage.getItem("quick_quiz_is_host") === "true";
      if (savedName && savedRoom) {
        get(ref(db, `rooms/${savedRoom}/users/${savedName}`)).then((snap) => {
          if (snap.exists()) {
            setRoomId(savedRoom);
            setIsRoomHost(savedHost);
            setUserName(savedName);
            setIsJoined(true);
            update(ref(db, `rooms/${savedRoom}/users/${savedName}`), { isOnline: true });
            onDisconnect(ref(db, `rooms/${savedRoom}/users/${savedName}/isOnline`)).set(false);
          } else {
            localStorage.removeItem("quick_quiz_user_name");
            localStorage.removeItem("quick_quiz_room_id");
            localStorage.removeItem("quick_quiz_is_host");
          }
        });
      }
    }
  }, []);

  // --- ルームIDが確定したらFirebase購読開姁E---
  useEffect(() => {
    if (!roomId) return;
    const unsubState = onValue(ref(db, `rooms/${roomId}/appState`), (s) => s.exists() && setAppState(s.val()));
    const unsubQuestions = onValue(ref(db, `rooms/${roomId}/questions`), (s) =>
      s.exists() ? setQuestions(s.val()) : setQuestions({})
    );
    const unsubAnswers = onValue(ref(db, `rooms/${roomId}/currentAnswers`), (s) =>
      s.exists() ? setCurrentAnswers(s.val()) : setCurrentAnswers({})
    );
    const unsubUsers = onValue(ref(db, `rooms/${roomId}/users`), (s) => {
      setUsers(s.exists() ? s.val() : {});
    });
    return () => { unsubState(); unsubQuestions(); unsubUsers(); unsubAnswers(); };
  }, [roomId]);

  // --- 管理者用：全ルーム一覧購読 ---
  useEffect(() => {
    const ownerLineId = process.env.NEXT_PUBLIC_OWNER_LINE_ID;
    if (!lineProfile || !ownerLineId || lineProfile.userId !== ownerLineId) return;
    const unsubRooms = onValue(ref(db, "rooms"), (s) => {
      setActiveRooms(s.exists() ? Object.keys(s.val()) : []);
    });
    return () => unsubRooms();
  }, [lineProfile]);

  // --- isJoined確定後に確実にisOnline:trueを書き込む ---
  useEffect(() => {
    if (!isJoined || !userName || !roomId) return;
    update(ref(db, `rooms/${roomId}/users/${userName}`), { isOnline: true });
    onDisconnect(ref(db, `rooms/${roomId}/users/${userName}/isOnline`)).set(false);
    const goOnline = () => update(ref(db, `rooms/${roomId}/users/${userName}`), { isOnline: true });
    const handleVisibility = () => { if (document.visibilityState === "visible") goOnline(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", goOnline);
    window.addEventListener("pageshow", goOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", goOnline);
      window.removeEventListener("pageshow", goOnline);
    };
  }, [isJoined, userName, roomId]);

  // --- 登録済み問題�E復允E---
  useEffect(() => {
    if (isJoined && userName && questions && questions[userName]) {
      setMyQuestion(questions[userName]);
    }
  }, [questions, isJoined, userName]);

  // --- タイマ�E処琁E---
  useEffect(() => {
    if (appState.mode === "execution" && appState.currentQuestionId) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - appState.questionStartTime) / 1000);
        const remaining = appState.timeLimit - elapsed;
        setTimeLeft(remaining > 0 ? remaining : 0);
      }, 500);
      return () => clearInterval(interval);
    }
  }, [appState.mode, appState.currentQuestionId, appState.questionStartTime, appState.timeLimit]);

  // --- タイムアチE�E征E秒で自動結果発表 ---
  useEffect(() => {
    if (appState.mode !== "execution" || timeLeft !== 0) return;
    const timer = setTimeout(() => showResults(), 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, timeLeft]);

  // --- カウントダウン処琁E---
  useEffect(() => {
    if (appState.mode === "countdown") {
      const startTime = appState.countdownStartTime || Date.now();
      const tick = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed === 0) { setShowReadyScreen(true); setCountdownValue(3); }
        else if (elapsed >= 1 && elapsed <= 3) { setShowReadyScreen(false); setCountdownValue(4 - elapsed); }
      };
      tick();
      const interval = setInterval(tick, 200);
      return () => clearInterval(interval);
    } else {
      setShowReadyScreen(false);
    }
  }, [appState.mode, appState.countdownStartTime]);

  // --- 全員準備完亁E��ェチE�� ---
  useEffect(() => {
    if (appState.mode !== "registration" && appState.mode !== "result") return;
    if (!roomId) return;
    const userEntries = Object.entries(users);
    if (userEntries.length === 0) return;
    const onlineUsers = userEntries.filter(([, d]) => d.isOnline !== false);
    if (onlineUsers.length === 0) return;
    const allReady = onlineUsers.every(([, d]) => d.isReady === true);
    if (!allReady) return;
    if (appState.mode === "result") {
      const questionIds = Object.keys(questions || {});
      const askedIds = appState.askedQuestions ? Object.keys(appState.askedQuestions) : [];
      const unaskedIds = questionIds.filter((id) => !askedIds.includes(id));
      if (unaskedIds.length === 0) {
        runTransaction(ref(db, `rooms/${roomId}/appState/mode`), (currentMode) => {
          if (currentMode === "result") return "finalResult";
          return;
        }).then((result) => {
          if (result.committed) {
            const updates: Record<string, boolean> = {};
            userEntries.forEach(([name]) => { updates[`rooms/${roomId}/users/${name}/isReady`] = false; });
            update(ref(db), updates);
          }
        });
        return;
      }
    }
    runTransaction(ref(db, `rooms/${roomId}/appState/mode`), (currentMode) => {
      if (currentMode === "registration" || currentMode === "result") return "countdown";
      return;
    }).then((result) => {
      if (result.committed) {
        update(ref(db, `rooms/${roomId}/appState`), { countdownStartTime: Date.now() });
      }
    });
  }, [users, appState.mode, appState.askedQuestions, questions, roomId]);

  // --- カウントダウン完亁E��に自動�E顁E---
  useEffect(() => {
    if (appState.mode !== "countdown" || !appState.countdownStartTime || !roomId) return;
    const remaining = 4000 - (Date.now() - appState.countdownStartTime);
    const delay = Math.max(remaining, 0);
    const timer = setTimeout(() => {
      runTransaction(ref(db, `rooms/${roomId}/appState/mode`), (currentMode) => {
        if (currentMode === "countdown") return "executing_transition";
        return;
      }).then((result) => {
        if (!result.committed) return;
        const updates: Record<string, boolean> = {};
        Object.keys(users).forEach((name) => { updates[`rooms/${roomId}/users/${name}/isReady`] = false; });
        update(ref(db), updates)
          .then(() => nextQuestion())
          .catch(() => update(ref(db, `rooms/${roomId}/appState`), { mode: "countdown" }));
      }).catch(() => update(ref(db, `rooms/${roomId}/appState`), { mode: "countdown" }));
    }, delay);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, appState.countdownStartTime, roomId]);

  // --- 出題開始時にチE��トユーザーを�E動回答（未回答�E場合�Eみ�E�E---
  useEffect(() => {
    if (appState.mode !== "execution" || !appState.currentQuestionId || !roomId) return;
    const testUsers = Object.keys(users).filter((name) => name.startsWith("テスト"));
    if (testUsers.length === 0) return;
    const timeLimit = appState.timeLimit || 20;
    const timers = testUsers.map((name) => {
      const randomChoice = Math.floor(Math.random() * 4);
      const randomDelay = Math.floor((0.5 + Math.random() * (timeLimit * 0.95 - 0.5)) * 1000);
      return setTimeout(async () => {
        const snap = await get(ref(db, `rooms/${roomId}/appState/mode`));
        if (snap.val() !== "execution") return;
        const answerSnap = await get(ref(db, `rooms/${roomId}/currentAnswers/${name}`));
        if (answerSnap.exists()) return;
        await set(ref(db, `rooms/${roomId}/currentAnswers/${name}`), {
          choice: randomChoice,
          timeTaken: parseFloat(((Date.now() - appState.questionStartTime) / 1000).toFixed(3)),
        });
      }, randomDelay);
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, appState.currentQuestionId, roomId]);

  // --- resultモードに移行したらチE��トユーザーのisReadyを�E動trueに ---
  useEffect(() => {
    if (appState.mode !== "result" || !roomId) return;
    const testUsers = Object.keys(users).filter((name) => name.startsWith("テスト"));
    if (testUsers.length === 0) return;
    const updates: Record<string, boolean> = {};
    testUsers.forEach((name) => { updates[`rooms/${roomId}/users/${name}/isReady`] = true; });
    update(ref(db), updates);
  }, [appState.mode, users, roomId]);

  // --- 新しい問題が出た時のリセチE�� ---
  useEffect(() => {
    setHasAnswered(false);
  }, [appState.currentQuestionId]);

  // --- 結果発表フェーズ管琁E---
  // idle ↁEshowCorrect(即晁E ↁEshowRanking(2s征E ↁEshowFinalCountdown(2s後、最終問題�Eみ)
  useEffect(() => {
    if (appState.mode !== "result" || !appState.currentQuestionId) {
      setResultPhase("idle");
      setResultRevealIndex(0);
      setFinalCountdown(appState.finalTransitionDelay ?? 5);
      return;
    }
    const currentQ = questions[appState.currentQuestionId];
    if (currentQ) {
      const resultsArray = Object.entries(currentAnswers).map(([name, data]) => ({
        name,
        isCorrect: data.choice === currentQ.correctIndex,
        timeTaken: data.timeTaken || 0,
        choice: data.choice,
        pointsEarned: data.pointsEarned || 0,
      }));
      resultsArray.sort((a, b) => {
        if (a.isCorrect !== b.isCorrect) return a.isCorrect ? 1 : -1;
        return a.timeTaken - b.timeTaken;
      });
      setSortedResults(resultsArray);
    }
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => setResultPhase("showCorrect"), 0),
      setTimeout(() => {
        setResultPhase("showRanking");
        setResultRevealIndex(0);
        const correctArr = Object.entries(currentAnswers)
          .filter(([, d]) => currentQ && d.choice === currentQ.correctIndex)
          .sort(([, a], [, b]) => (b.timeTaken || 0) - (a.timeTaken || 0)); // 遁E��頁E
        let idx = 0;
        const revealInterval = setInterval(() => {
          idx += 1;
          setResultRevealIndex(idx);
          if (idx >= correctArr.length) clearInterval(revealInterval);
        }, 1500);
      }, 2000),
    ];

    // 正解老E��遁E��頁E��画面表示頁E��にソートしてsortedResultsを上書ぁE
    if (currentQ) {
      const resultsArray = Object.entries(currentAnswers).map(([name, data]) => ({
        name,
        isCorrect: data.choice === currentQ.correctIndex,
        timeTaken: data.timeTaken || 0,
        choice: data.choice,
        pointsEarned: data.pointsEarned || 0,
      }));
      // 正解老E�E遁E��頁E��不正解老E�E最後にまとめる
      resultsArray.sort((a, b) => {
        if (a.isCorrect !== b.isCorrect) return a.isCorrect ? -1 : 1;
        return b.timeTaken - a.timeTaken; // 正解老E�Eは遁E��頁E
      });
      setSortedResults(resultsArray);
    }
    if (isLastQuestion) {
      const finalDelay = appState.finalTransitionDelay ?? 5;
      const correctCount = Object.entries(currentAnswers)
        .filter(([, d]) => currentQ && d.choice === currentQ.correctIndex).length;
      const t5 = 2000 + (correctCount * 1500) + ((appState.rankingDisplayTime ?? 5) * 1000);
      timers.push(setTimeout(() => {
        setResultPhase("showFinalCountdown");
        setFinalCountdown(finalDelay);
        const countInterval = setInterval(() => {
          setFinalCountdown((prev) => {
            if (prev <= 1) { clearInterval(countInterval); return 0; }
            return prev - 1;
          });
        }, 1000);
        // 最終結果への遷移はトランザクションで一度だけ実衁E
        setTimeout(() => {
          clearInterval(countInterval);
          runTransaction(ref(db, `rooms/${roomId}/appState/mode`), (currentMode) => {
            if (currentMode === "result") return "finalResult";
            return;
          });
        }, finalDelay * 1000);
      }, t5));
    }
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, appState.currentQuestionId]);

  // --- 最終結果アニメーション ---
  useEffect(() => {
    if (appState.mode !== "finalResult") {
      finalInitRef.current = false;
      setSortedFinalResults([]);
      setFinalRevealIndex(0);
      return;
    }
    if (finalInitRef.current) return;
    if (Object.keys(users).length === 0) return;
    finalInitRef.current = true;
      const finalArr = Object.entries(users || {}).map(([name, data]) => ({
        name,
        score: data.score ?? 0,
        totalTimeTaken: data.totalTimeTaken ?? 0,
        rank: 0,
        pictureUrl: data.pictureUrl || "",
      }));
      finalArr.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.totalTimeTaken - b.totalTimeTaken;
      });
      finalArr.forEach((item, idx) => { item.rank = idx + 1; });
      finalArr.reverse();
      setSortedFinalResults(finalArr);
      setFinalRevealIndex(0);
      const interval = setInterval(() => {
        setFinalRevealIndex((prev) =>
          prev >= finalArr.length ? (clearInterval(interval), prev) : prev + 1
        );
      }, 1500);
      return () => clearInterval(interval);
  }, [appState.mode, users]);

  // --- 初期化時の自動キチE��アウチE---
  useEffect(() => {
    if (isJoined && userName && autoLoginProcessed.current && (!users || !users[userName])) {
      setIsJoined(false);
      setUserName("");
      localStorage.removeItem("quick_quiz_user_name");
      setMyQuestion({ text: "", choices: ["", "", "", ""], correctIndex: 0 });
    }
  }, [users, isJoined, userName]);

  // --- アクション関数 ---
  const loginWithLine = () => {
    const clientId = process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/auth/line-callback`);
    const state = Math.random().toString(36).slice(2);
    window.location.href = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=profile`;
  };

  const generateRoomId = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  };

  const createRoom = async () => {
    if (!lineProfile) return;
    const newRoomId = generateRoomId();
    const displayName = lineProfile.displayName;
    await update(ref(db, `rooms/${newRoomId}/appState`), {
      mode: "registration", timeLimit: 20, finalTransitionDelay: 5,
      rankingDisplayTime: 5, currentQuestionId: null, questionStartTime: 0, askedQuestions: null,
    });
    await set(ref(db, `rooms/${newRoomId}/users/${displayName}`), {
      score: 0, totalTimeTaken: 0, isOnline: true, isReady: false,
      lineUserId: lineProfile.userId, displayName, pictureUrl: lineProfile.pictureUrl ?? "",
    });
    onDisconnect(ref(db, `rooms/${newRoomId}/users/${displayName}/isOnline`)).set(false);
    localStorage.setItem("quick_quiz_user_name", displayName);
    localStorage.setItem("quick_quiz_room_id", newRoomId);
    localStorage.setItem("quick_quiz_is_host", "true");
    setRoomId(newRoomId);
    setIsRoomHost(true);
    setUserName(displayName);
    setIsJoined(true);
  };

  const joinRoom = async (inputRoomId: string) => {
    if (!lineProfile) return;
    const rid = inputRoomId.trim().toUpperCase();
    const snap = await get(ref(db, `rooms/${rid}/appState`));
    if (!snap.exists()) {
      alert("ルームが見つかりません。IDを確認してください。");
      return;
    }
    const displayName = lineProfile.displayName;
    const userRef = ref(db, `rooms/${rid}/users/${displayName}`);
    const existSnap = await get(userRef);
    const existingScore = existSnap.exists() ? (existSnap.val().score ?? 0) : 0;
    const existingTotalTimeTaken = existSnap.exists() ? (existSnap.val().totalTimeTaken ?? 0) : 0;
    await set(userRef, {
      score: existingScore, totalTimeTaken: existingTotalTimeTaken,
      isOnline: true, isReady: false,
      lineUserId: lineProfile.userId, displayName, pictureUrl: lineProfile.pictureUrl ?? "",
    });
    onDisconnect(ref(db, `rooms/${rid}/users/${displayName}/isOnline`)).set(false);
    localStorage.setItem("quick_quiz_user_name", displayName);
    localStorage.setItem("quick_quiz_room_id", rid);
    localStorage.setItem("quick_quiz_is_host", "false");
    setRoomId(rid);
    setIsRoomHost(false);
    setUserName(displayName);
    if (questions[displayName]) setMyQuestion(questions[displayName]);
    setIsJoined(true);
  };

  const join = async () => { /* legacy */ };

  const toggleReady = async () => {
    if (!userName || !roomId) return;
    if (appState.mode === "registration" && !questions[userName]) return;
    const current = users[userName]?.isReady || false;
    await update(ref(db, `rooms/${roomId}/users/${userName}`), { isReady: !current });
  };

  const saveQuestion = async () => {
    if (!roomId) return;
    await set(ref(db, `rooms/${roomId}/questions/${userName}`), myQuestion);
    setShowSaveModal(false);
    setTimeout(() => setShowSaveModal(true), 50);
    setTimeout(() => setShowSaveModal(false), 2500);
  };

  const setMode = async (mode: AppState["mode"]) => {
    if (!roomId) return;
    update(ref(db, `rooms/${roomId}/appState`), { mode });
  };

  const resetGameToRegistration = async () => {
    if (!roomId) return;
    await Promise.all([
      remove(ref(db, `rooms/${roomId}/users`)),
      remove(ref(db, `rooms/${roomId}/questions`)),
      remove(ref(db, `rooms/${roomId}/currentAnswers`)),
      update(ref(db, `rooms/${roomId}/appState`), {
        mode: "registration", currentQuestionId: null, askedQuestions: null, countdownStartTime: null,
      }),
    ]);
    setShowResetModal(false);
    setTimeout(() => setShowResetModal(true), 50);
    setTimeout(() => setShowResetModal(false), 2500);
  };

  const removeUser = async (targetName: string) => {
    if (!roomId) return;
    await Promise.all([
      remove(ref(db, `rooms/${roomId}/users/${targetName}`)),
      remove(ref(db, `rooms/${roomId}/questions/${targetName}`)),
      remove(ref(db, `rooms/${roomId}/currentAnswers/${targetName}`)),
    ]);
  };

  const addTestUsers = async (count: number) => {
    if (!roomId) return;
    const updates: Record<string, any> = {};
    for (let i = 1; i <= count; i++) {
      const name = `テスト${i}`;
      updates[`rooms/${roomId}/users/${name}`] = {
        score: 0, totalTimeTaken: 0, isOnline: true, isReady: true,
        lineUserId: `test_user_${i}`, displayName: name, pictureUrl: "",
      };
      updates[`rooms/${roomId}/questions/${name}`] = {
        text: `テスト用問題${i}`,
        choices: ["テスト選択肢1", "テスト選択肢2", "テスト選択肢3", "テスト選択肢4"],
        correctIndex: Math.floor(Math.random() * 4),
      };
    }
    await update(ref(db), updates);
  };

  const runTestAnswers = async () => {
    if (!roomId || appState.mode !== "execution" || !appState.currentQuestionId) return;
    const testUsers = Object.entries(users).filter(([name]) => name.startsWith("テスト"));
    const timeLimit = appState.timeLimit || 20;
    for (const [name] of testUsers) {
      const randomChoice = Math.floor(Math.random() * 4);
      const randomTime = 0.5 + Math.random() * (timeLimit * 0.95 - 0.5);
      await set(ref(db, `rooms/${roomId}/currentAnswers/${name}`), {
        choice: randomChoice,
        timeTaken: parseFloat(randomTime.toFixed(3)),
      });
    }
  };

  const nextQuestion = async () => {
    if (!roomId) return;
    const questionIds = Object.keys(questions || {});
    if (questionIds.length === 0) return alert("問題が登録されていません");
    const askedIds = appState.askedQuestions ? Object.keys(appState.askedQuestions) : [];
    const unaskedIds = questionIds.filter((id) => !askedIds.includes(id));
    if (unaskedIds.length === 0) return alert("すべての問題が出題済みです。");
    const randomId = unaskedIds[Math.floor(Math.random() * unaskedIds.length)];
    await update(ref(db), {
      [`rooms/${roomId}/appState/mode`]: "execution",
      [`rooms/${roomId}/appState/currentQuestionId`]: randomId,
      [`rooms/${roomId}/appState/questionStartTime`]: Date.now(),
      [`rooms/${roomId}/appState/askedQuestions/${randomId}`]: true,
      [`rooms/${roomId}/currentAnswers`]: null,
    });
  };

  const showResults = async () => {
    if (!roomId) return;
    const txResult = await runTransaction(ref(db, `rooms/${roomId}/appState/mode`), (currentMode) => {
      if (currentMode === "execution") return "calculating";
      return;
    });
    if (!txResult.committed) return;
    const currentQ = appState.currentQuestionId ? questions[appState.currentQuestionId] : null;
    if (currentQ) {
      const updates: any = {};
      const correctAnswers = Object.entries(currentAnswers)
        .filter(([, d]) => d.choice === currentQ.correctIndex)
        .sort(([, a], [, b]) => (a.timeTaken || 0) - (b.timeTaken || 0));
      correctAnswers.forEach(([userId], index) => {
        let points = 1;
        if (index === 0) points += 3;
        else if (index === 1) points += 2;
        else if (index === 2) points += 1;
        updates[`rooms/${roomId}/users/${userId}/score`] = (users[userId]?.score || 0) + points;
        updates[`rooms/${roomId}/currentAnswers/${userId}/pointsEarned`] = points;
      });
      Object.entries(currentAnswers).forEach(([userId, answerData]) => {
        const isCorrect = answerData.choice === currentQ.correctIndex;
        const addTime = isCorrect ? (answerData.timeTaken || 0) : (appState.timeLimit || 20);
        updates[`rooms/${roomId}/users/${userId}/totalTimeTaken`] = (users[userId]?.totalTimeTaken || 0) + addTime;
      });
      if (Object.keys(updates).length > 0) await update(ref(db), updates);
    }
    await update(ref(db, `rooms/${roomId}/appState`), {
      mode: "result",
      currentQuestionText: currentQ?.text ?? "",
    });
  };

  const submitAnswer = async (choiceIndex: number) => {
    if (!roomId || hasAnswered || timeLeft === 0) return;
    setHasAnswered(true);
    const timeTaken = (Date.now() - appState.questionStartTime) / 1000;
    await set(ref(db, `rooms/${roomId}/currentAnswers/${userName}`), {
      choice: choiceIndex,
      timeTaken: parseFloat(timeTaken.toFixed(3)),
    });
  };

  return {
    lineProfile, userName, isJoined, roomId, isRoomHost, roomInput, setRoomInput,
    appState, questions, users, currentAnswers,
    myQuestion, setMyQuestion, timeLeft, hasAnswered, showSaveModal, showResetModal,
    countdownValue, showReadyScreen,
    sortedResults, resultPhase, resultRevealIndex, finalCountdown,
    finalRevealIndex, sortedFinalResults,
    totalQuestions, askedCount, isLastQuestion,
    activeRooms, loginWithLine, createRoom, joinRoom, join, toggleReady, saveQuestion, resetGameToRegistration,
    removeUser, addTestUsers, runTestAnswers, nextQuestion, showResults, submitAnswer,
  };
}
