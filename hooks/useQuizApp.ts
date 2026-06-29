// hooks/useQuizApp.ts
import { useState, useEffect, useRef } from "react";
import { db, auth, signInAnonymously } from "../lib/firebase";
import { ref, onValue, set, update, get, onDisconnect } from "firebase/database";

// --- 型定義 ---
export type AppState = {
  mode: "registration" | "countdown" | "execution" | "result" | "finalResult";
  timeLimit: number;
  currentQuestionId: string | null;
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

// --- バックエンドロジック本体 ---
export function useQuizApp() {
  const [lineProfile, setLineProfile] = useState<LineProfile | null>(null);
  const [userName, setUserName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isJoined, setIsJoined] = useState(false);

  const [appState, setAppState] = useState<AppState>({
    mode: "registration",
    timeLimit: 20,
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

  const [revealIndex, setRevealIndex] = useState(0);
  const [sortedResults, setSortedResults] = useState<any[]>([]);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);

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
      } catch {
        // ignore
      }
    }
  }, []);

  // --- Firebaseデータ購読 & 自動ログインチェック ---
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);

    const params = new URLSearchParams(window.location.search);
    const adminParam = params.get("admin");
    const secretKey = process.env.NEXT_PUBLIC_ADMIN_SECRET;
    if (adminParam && secretKey && adminParam === secretKey) setIsAdmin(true);

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

    return () => {
      unsubState();
      unsubQuestions();
      unsubUsers();
      unsubAnswers();
    };
  }, []);

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

  // --- カウントダウン処理 ---
  // countdownStartTime から経過秒数で Ready?(0秒目) → 3(1秒目) → 2(2秒目) → 1(3秒目) → 出題(4秒目)
  useEffect(() => {
    if (appState.mode === "countdown") {
      countdownInitRef.current = true;
      const startTime = appState.countdownStartTime || Date.now();

      const tick = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed === 0) {
          setShowReadyScreen(true);
          setCountdownValue(3);
        } else if (elapsed >= 1 && elapsed <= 3) {
          setShowReadyScreen(false);
          setCountdownValue(4 - elapsed); // 1秒→3, 2秒→2, 3秒→1
        }
      };

      tick();
      const interval = setInterval(tick, 200);
      return () => clearInterval(interval);
    } else {
      countdownInitRef.current = false;
      setShowReadyScreen(false);
    }
  }, [appState.mode, appState.countdownStartTime]);

  // --- 全員準備完了チェック（自動でcountdownへ移行） ---
  useEffect(() => {
    if (appState.mode !== "registration") return;
    const userEntries = Object.entries(users);
    if (userEntries.length === 0) return;
    const onlineUsers = userEntries.filter(([, d]) => d.isOnline !== false);
    if (onlineUsers.length === 0) return;
    const allReady = onlineUsers.every(([, d]) => d.isReady === true);
    if (allReady) {
      update(ref(db, "appState"), {
        mode: "countdown",
        countdownStartTime: Date.now(),
      });
    }
  }, [users, appState.mode]);

  // --- カウントダウン完了後に自動出題 ---
  useEffect(() => {
    if (appState.mode !== "countdown" || !appState.countdownStartTime) return;
    const remaining = 4000 - (Date.now() - appState.countdownStartTime);
    const delay = Math.max(remaining, 0);
    const timer = setTimeout(() => {
      // 全ユーザーのisReadyをリセット
      const updates: Record<string, boolean | null> = {};
      Object.keys(users).forEach((name) => {
        updates[`users/${name}/isReady`] = false as boolean;
      });
      update(ref(db), updates).then(() => nextQuestion());
    }, delay);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.mode, appState.countdownStartTime]);

  // --- 新しい問題が出た時のリセット ---
  useEffect(() => {
    setHasAnswered(false);
    setLocalStartTime(Date.now());
  }, [appState.currentQuestionId]);

  // --- 各問の結果発表アニメーション ---
  useEffect(() => {
    if (appState.mode === "result" && appState.currentQuestionId) {
      const currentQ = questions[appState.currentQuestionId];
      if (!currentQ) return;

      const resultsArray = Object.entries(currentAnswers).map(([name, data]) => ({
        name,
        isCorrect: data.choice === currentQ.correctIndex,
        timeTaken: data.timeTaken || 0,
        choice: data.choice,
        pointsEarned: data.pointsEarned || 0,
      }));

      resultsArray.sort((a, b) => {
        if (a.isCorrect !== b.isCorrect) return a.isCorrect ? 1 : -1;
        return b.timeTaken - a.timeTaken;
      });

      setSortedResults(resultsArray);
      setRevealIndex(0);

      const interval = setInterval(() => {
        setRevealIndex((prev) =>
          prev >= resultsArray.length ? (clearInterval(interval), prev) : prev + 1
        );
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [appState.mode, appState.currentQuestionId, currentAnswers, questions]);

  // --- 最終結果アニメーション ---
  useEffect(() => {
    if (appState.mode === "finalResult" && !finalInitRef.current) {
      finalInitRef.current = true;
      const finalArr = Object.entries(users || {}).map(([name, data]) => ({
        name,
        score: data.score,
        rank: 0,
        pictureUrl: data.pictureUrl || "",
      }));

      finalArr.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      });

      let currentRank = 1,
        prevScore = -1;
      finalArr.forEach((item, idx) => {
        if (item.score !== prevScore) {
          currentRank = idx + 1;
          prevScore = item.score;
        }
        item.rank = currentRank;
      });
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

  // --- 正解表示タイマー ---
  useEffect(() => {
    if (appState.mode !== "result") return setShowCorrectAnswer(false);
    if (sortedResults.length === 0 || revealIndex === sortedResults.length) {
      const timer = setTimeout(() => setShowCorrectAnswer(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [appState.mode, revealIndex, sortedResults.length]);

  // --- 初期化時の自動キックアウト ---
  useEffect(() => {
    if (
      isJoined &&
      userName &&
      autoLoginProcessed.current &&
      (!users || !users[userName])
    ) {
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
    const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=profile`;
    window.location.href = url;
  };

  const join = async () => {
    if (!lineProfile) return;
    const displayName = lineProfile.displayName;
    const userRef = ref(db, `users/${displayName}`);

    let existingScore = 0;
    try {
      const snap = await get(userRef);
      existingScore = snap.exists() ? (snap.val().score ?? 0) : 0;
    } catch {
      // 取得失敗時は0で続行
    }

    try {
      await set(userRef, {
        score: existingScore,
        isOnline: true,
        isReady: false,
        lineUserId: lineProfile.userId,
        displayName: displayName,
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
    await update(ref(db), {
      "appState/mode": "registration",
      "appState/currentQuestionId": null,
      "appState/askedQuestions": null,
      "appState/countdownStartTime": null,
      users: null,
      questions: null,
      currentAnswers: null,
    });
    setShowResetModal(false);
    setTimeout(() => setShowResetModal(true), 50);
    setTimeout(() => setShowResetModal(false), 2500);
  };

  const nextQuestion = async () => {
    const questionIds = Object.keys(questions || {});
    if (questionIds.length === 0) return alert("問題が登録されていません");

    const askedIds = appState.askedQuestions ? Object.keys(appState.askedQuestions) : [];
    const unaskedIds = questionIds.filter((id) => !askedIds.includes(id));
    if (unaskedIds.length === 0) return alert("すべての問題が出題済みです。最終結果を発表してください。");

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
      if (Object.keys(updates).length > 0) await update(ref(db), updates);
    }
    await setMode("result");
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
    lineProfile,
    userName,
    setUserName,
    isAdmin,
    isJoined,
    appState,
    questions,
    users,
    currentAnswers,
    myQuestion,
    setMyQuestion,
    timeLeft,
    hasAnswered,
    showSaveModal,
    showResetModal,
    countdownValue,
    showReadyScreen,
    revealIndex,
    sortedResults,
    showCorrectAnswer,
    finalRevealIndex,
    sortedFinalResults,
    totalQuestions,
    askedCount,
    isLastQuestion,
    loginWithLine,
    join,
    toggleReady,
    saveQuestion,
    setMode,
    resetGameToRegistration,
    nextQuestion,
    showResults,
    submitAnswer,
  };
}
