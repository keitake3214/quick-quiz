// hooks/useQuizApp.ts
import { useState, useEffect, useRef } from "react";
import { db, auth, signInAnonymously } from "../lib/firebase";
import { ref, onValue, set, update, get, remove, onDisconnect } from "firebase/database";

// --- 型定義 ---
export type AppState = {
  mode: "registration" | "countdown" | "execution" | "result" | "finalResult";
  timeLimit: number;
  finalTransitionDelay: number;
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

// --- バックエンドロジック本体 ---
export function useQuizApp() {
  const [lineProfile, setLineProfile] = useState<LineProfile | null>(null);
  const [userName, setUserName] = useState("");
  const [isJoined, setIsJoined] = useState(false);

  const [appState, setAppState] = useState<AppState>({
    mode: "registration",
    timeLimit: 20,
    finalTransitionDelay: 5,
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
  const [localStartTime, setLocalStartTime] = useState(0);

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
  const countdownInitRef = useRef(false);

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

  // --- 進行状況の計算 ---
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

  // --- Firebaseデータ購読 & 自動ログインチェック ---
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsubState = onValue(ref(db, "appState"), (s) => s.exists() && setAppState(s.val()));
    const unsubQuestions = onValue(ref(db, "questions"), (s) =>
      s.exists() ? setQuestions(s.val()) : setQuestions({})
    );
    const unsubAnswers = onValue(ref(db, "currentAnswers"), (s) =>
      s.exists() ? setCurrentAnswers(s.val()) : setCurrentAnswers({})
    );
    const unsubUsers = onValue(ref(db, "users"), (s) => {
      const usersData = s.exists() ? s.val() : {};
      setUsers(usersData);
      if (!autoLoginProcessed.current) {
        autoLoginProcessed.current = true;
        const savedName = localStorage.getItem("quick_quiz_user_name");
        if (savedName && usersData[savedName]) {
          setUserName(savedName);
          setIsJoined(true);
          update(ref(db, `users/${savedName}`), { isOnline: true });
          onDisconnect(ref(db, `users/${savedName}/isOnline`)).set(false);
        } else if (savedName) {
          localStorage.removeItem("quick_quiz_user_name");
        }
      }
    });
    return () => { unsubState(); unsubQuestions(); unsubUsers(); unsubAnswers(); };
  }, []);

  // --- isJoined確定後に確実にisOnline:trueを書き込む ---
  useEffect(() => {
    if (!isJoined || !userName) return;
    update(ref(db, `users/${userName}`), { isOnline: true });
    onDisconnect(ref(db, `users/${userName}/isOnline`)).set(false);
    const goOnline = () => update(ref(db, `users/${userName}`), { isOnline: true });
    const handleVisibility = () => { if (document.visibilityState === "visible") goOnline(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", goOnline);
    window.addEventListener("pageshow", goOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", goOnline);
      window.removeEventListener("pageshow", goOnline);
    };
  }, [isJoined, userName]);

  // --- 登録済み問題の復元 ---
  useEffect(() => {
    if (isJoined && userName && questions && questions[userName]) {
      setMyQuestion(questions[userName]);
    }
  }, [questions, isJoined, userName]);

  // --- タイマー処理 ---
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

  // --- タイムアップ後2秒で自動結果発表 ---
  useEffect(() => {
    if (appState.mode !== "execution" || timeLeft !== 0) return;
    const timer = setTimeout(() => showResults(), 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, timeLeft]);

  // --- カウントダウン処理 ---
  useEffect(() => {
    if (appState.mode === "countdown") {
      countdownInitRef.current = true;
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
      countdownInitRef.current = false;
      setShowReadyScreen(false);
    }
  }, [appState.mode, appState.countdownStartTime]);

  // --- 全員準備完了チェック ---
  useEffect(() => {
    if (appState.mode !== "registration" && appState.mode !== "result") return;
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
        const updates: Record<string, boolean> = {};
        userEntries.forEach(([name]) => { updates[`users/${name}/isReady`] = false; });
        update(ref(db), updates).then(() => setMode("finalResult"));
        return;
      }
    }
    update(ref(db, "appState"), { mode: "countdown", countdownStartTime: Date.now() });
  }, [users, appState.mode, appState.askedQuestions, questions]);

  // --- カウントダウン完了後に自動出題 ---
  useEffect(() => {
    if (appState.mode !== "countdown" || !appState.countdownStartTime) return;
    const remaining = 4000 - (Date.now() - appState.countdownStartTime);
    const delay = Math.max(remaining, 0);
    const timer = setTimeout(() => {
      const updates: Record<string, boolean> = {};
      Object.keys(users).forEach((name) => { updates[`users/${name}/isReady`] = false; });
      update(ref(db), updates).then(() => nextQuestion());
    }, delay);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, appState.countdownStartTime]);

  // --- 出題開始時にテストユーザーを自動回答 ---
  useEffect(() => {
    if (appState.mode !== "execution" || !appState.currentQuestionId) return;
    const testUsers = Object.keys(users).filter((name) => name.startsWith("テスト"));
    if (testUsers.length === 0) return;
    const timeLimit = appState.timeLimit || 20;
    const timers = testUsers.map((name) => {
      const randomChoice = Math.floor(Math.random() * 4);
      const randomDelay = Math.floor((0.5 + Math.random() * (timeLimit * 0.95 - 0.5)) * 1000);
      return setTimeout(async () => {
        const snap = await get(ref(db, "appState/mode"));
        if (snap.val() !== "execution") return;
        await set(ref(db, `currentAnswers/${name}`), {
          choice: randomChoice,
          timeTaken: parseFloat((randomDelay / 1000).toFixed(3)),
        });
      }, randomDelay);
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, appState.currentQuestionId]);

  // --- resultモードに移行したらテストユーザーのisReadyを自動trueに ---
  useEffect(() => {
    if (appState.mode !== "result") return;
    const testUsers = Object.keys(users).filter((name) => name.startsWith("テスト"));
    if (testUsers.length === 0) return;
    const updates: Record<string, boolean> = {};
    testUsers.forEach((name) => { updates[`users/${name}/isReady`] = true; });
    update(ref(db), updates);
  }, [appState.mode, users]);

  // --- 新しい問題が出た時のリセット ---
  useEffect(() => {
    setHasAnswered(false);
    setLocalStartTime(Date.now());
  }, [appState.currentQuestionId]);

  // --- 結果発表フェーズ管理 ---
  // idle → showCorrect(即時) → showRanking(2s後) → showFinalCountdown(2s後、最終問題のみ)
  useEffect(() => {
    if (appState.mode !== "result" || !appState.currentQuestionId) {
      setResultPhase("idle");
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
          .sort(([, a], [, b]) => (b.timeTaken || 0) - (a.timeTaken || 0)); // 遅い順
        let idx = 0;
        const revealInterval = setInterval(() => {
          idx += 1;
          setResultRevealIndex(idx);
          if (idx >= correctArr.length) clearInterval(revealInterval);
        }, 1500);
      }, 2000),
    ];

    // 正解者を遅い順（画面表示順）にソートしてsortedResultsを上書き
    if (currentQ) {
      const resultsArray = Object.entries(currentAnswers).map(([name, data]) => ({
        name,
        isCorrect: data.choice === currentQ.correctIndex,
        timeTaken: data.timeTaken || 0,
        choice: data.choice,
        pointsEarned: data.pointsEarned || 0,
      }));
      // 正解者は遅い順、不正解者は最後にまとめる
      resultsArray.sort((a, b) => {
        if (a.isCorrect !== b.isCorrect) return a.isCorrect ? -1 : 1;
        return b.timeTaken - a.timeTaken; // 正解者内は遅い順
      });
      setSortedResults(resultsArray);
    }
    if (isLastQuestion) {
      const finalDelay = appState.finalTransitionDelay ?? 5;
      timers.push(setTimeout(() => {
        setResultPhase("showFinalCountdown");
        setFinalCountdown(finalDelay);
        const countInterval = setInterval(() => {
          setFinalCountdown((prev) => {
            if (prev <= 1) { clearInterval(countInterval); return 0; }
            return prev - 1;
          });
        }, 1000);
        setTimeout(() => {
          clearInterval(countInterval);
          const updates: Record<string, boolean> = {};
          Object.entries(users).forEach(([name]) => { updates[`users/${name}/isReady`] = false; });
          update(ref(db), updates).then(() => setMode("finalResult"));
        }, finalDelay * 1000);
      }, 4000));
    }
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, appState.currentQuestionId]);

  // --- 最終結果アニメーション ---
  useEffect(() => {
    if (appState.mode === "finalResult" && !finalInitRef.current) {
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
    } else if (appState.mode !== "finalResult") {
      finalInitRef.current = false;
    }
  }, [appState.mode, users]);

  // --- 初期化時の自動キックアウト ---
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

  const join = async () => {
    if (!lineProfile) return;
    const displayName = lineProfile.displayName;
    const userRef = ref(db, `users/${displayName}`);
    let existingScore = 0;
    try {
      const snap = await get(userRef);
      existingScore = snap.exists() ? (snap.val().score ?? 0) : 0;
    } catch { /* 取得失敗時は0 */ }
    try {
      await set(userRef, {
        score: existingScore,
        totalTimeTaken: 0,
        isOnline: true,
        isReady: false,
        lineUserId: lineProfile.userId,
        displayName,
        pictureUrl: lineProfile.pictureUrl ?? "",
      });
    } catch (e) {
      console.error("[join error]", e);
      alert("参加に失敗しました: " + String(e));
      return;
    }
    onDisconnect(ref(db, `users/${displayName}/isOnline`)).set(false);
    localStorage.setItem("quick_quiz_user_name", displayName);
    setUserName(displayName);
    if (questions[displayName]) setMyQuestion(questions[displayName]);
    setIsJoined(true);
  };

  const toggleReady = async () => {
    if (!userName) return;
    if (appState.mode === "registration" && !questions[userName]) return;
    const current = users[userName]?.isReady || false;
    await update(ref(db, `users/${userName}`), { isReady: !current });
  };

  const saveQuestion = async () => {
    await set(ref(db, `questions/${userName}`), myQuestion);
    setShowSaveModal(false);
    setTimeout(() => setShowSaveModal(true), 50);
    setTimeout(() => setShowSaveModal(false), 2500);
  };

  const setMode = async (mode: AppState["mode"]) => update(ref(db, "appState"), { mode });

  const resetGameToRegistration = async () => {
    await Promise.all([
      remove(ref(db, "users")),
      remove(ref(db, "questions")),
      remove(ref(db, "currentAnswers")),
      update(ref(db, "appState"), {
        mode: "registration",
        currentQuestionId: null,
        askedQuestions: null,
        countdownStartTime: null,
      }),
    ]);
    setShowResetModal(false);
    setTimeout(() => setShowResetModal(true), 50);
    setTimeout(() => setShowResetModal(false), 2500);
  };

  const removeUser = async (targetName: string) => {
    await Promise.all([
      remove(ref(db, `users/${targetName}`)),
      remove(ref(db, `questions/${targetName}`)),
      remove(ref(db, `currentAnswers/${targetName}`)),
    ]);
  };

  const addTestUsers = async (count: number) => {
    const updates: Record<string, any> = {};
    for (let i = 1; i <= count; i++) {
      const name = `テスト${i}`;
      updates[`users/${name}`] = {
        score: 0, totalTimeTaken: 0, isOnline: true, isReady: true,
        lineUserId: `test_user_${i}`, displayName: name, pictureUrl: "",
      };
      updates[`questions/${name}`] = {
        text: "テスト用問題",
        choices: ["テスト選択肢1", "テスト選択肢2", "テスト選択肢3", "テスト選択肢4"],
        correctIndex: Math.floor(Math.random() * 4),
      };
    }
    await update(ref(db), updates);
  };

  const runTestAnswers = async () => {
    if (appState.mode !== "execution" || !appState.currentQuestionId) return;
    const testUsers = Object.entries(users).filter(([name]) => name.startsWith("テスト"));
    const timeLimit = appState.timeLimit || 20;
    for (const [name] of testUsers) {
      const randomChoice = Math.floor(Math.random() * 4);
      const randomTime = 0.5 + Math.random() * (timeLimit * 0.95 - 0.5);
      await set(ref(db, `currentAnswers/${name}`), {
        choice: randomChoice,
        timeTaken: parseFloat(randomTime.toFixed(3)),
      });
    }
  };

  const nextQuestion = async () => {
    const questionIds = Object.keys(questions || {});
    if (questionIds.length === 0) return alert("問題が登録されていません");
    const askedIds = appState.askedQuestions ? Object.keys(appState.askedQuestions) : [];
    const unaskedIds = questionIds.filter((id) => !askedIds.includes(id));
    if (unaskedIds.length === 0) return alert("すべての問題が出題済みです。");
    const randomId = unaskedIds[Math.floor(Math.random() * unaskedIds.length)];
    await update(ref(db), {
      "appState/mode": "execution",
      "appState/currentQuestionId": randomId,
      "appState/questionStartTime": Date.now(),
      [`appState/askedQuestions/${randomId}`]: true,
      currentAnswers: null,
    });
  };

  const showResults = async () => {
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
        updates[`users/${userId}/score`] = (users[userId]?.score || 0) + points;
        updates[`currentAnswers/${userId}/pointsEarned`] = points;
      });
      Object.entries(currentAnswers).forEach(([userId, answerData]) => {
        const isCorrect = answerData.choice === currentQ.correctIndex;
        const addTime = isCorrect ? (answerData.timeTaken || 0) : (appState.timeLimit || 20);
        updates[`users/${userId}/totalTimeTaken`] = (users[userId]?.totalTimeTaken || 0) + addTime;
      });
      if (Object.keys(updates).length > 0) await update(ref(db), updates);
    }
    await update(ref(db, "appState"), {
      mode: "result",
      currentQuestionText: currentQ?.text ?? "",
    });
  };

  const submitAnswer = async (choiceIndex: number) => {
    if (hasAnswered || timeLeft === 0) return;
    setHasAnswered(true);
    await set(ref(db, `currentAnswers/${userName}`), {
      choice: choiceIndex,
      timeTaken: (Date.now() - localStartTime) / 1000,
    });
  };

  return {
    lineProfile, userName, setUserName, isJoined, appState, questions, users, currentAnswers,
    myQuestion, setMyQuestion, timeLeft, hasAnswered, showSaveModal, showResetModal,
    countdownValue, showReadyScreen,
    sortedResults, resultPhase, resultRevealIndex, finalCountdown,
    finalRevealIndex, sortedFinalResults,
    totalQuestions, askedCount, isLastQuestion,
    loginWithLine, join, toggleReady, saveQuestion, setMode, resetGameToRegistration,
    removeUser, addTestUsers, runTestAnswers, nextQuestion, showResults, submitAnswer,
  };
}
