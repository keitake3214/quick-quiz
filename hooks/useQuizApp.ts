// hooks/useQuizApp.ts
import { useState, useEffect, useRef } from "react";
import { db, auth, signInAnonymously } from "../lib/firebase";
import { ref, onValue, set, update, get, onDisconnect } from "firebase/database";

// --- 型定義 ---
export type AppState = {
  mode: "registration" | "execution" | "result" | "finalResult";
  timeLimit: number;
  currentQuestionId: string | null;
  questionStartTime: number;
  askedQuestions?: Record<string, boolean>;
};

export type Question = {
  text: string;
  choices: string[];
  correctIndex: number;
};

export type UserData = { score: number; isOnline?: boolean };

export type AnswerData = {
  choice: number;
  timeTaken: number;
  pointsEarned?: number;
};

// --- バックエンドロジック本体 ---
export function useQuizApp() {
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
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  const [revealIndex, setRevealIndex] = useState(0);
  const [sortedResults, setSortedResults] = useState<any[]>([]);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);

  const [finalRevealIndex, setFinalRevealIndex] = useState(0);
  const [sortedFinalResults, setSortedFinalResults] = useState<any[]>([]);
  const finalInitRef = useRef(false);
  const autoLoginProcessed = useRef(false);

  const totalQuestions = Object.keys(questions || {}).length;
  const askedCount = appState.askedQuestions ? Object.keys(appState.askedQuestions).length : 0;
  const isLastQuestion = totalQuestions > 0 && askedCount >= totalQuestions;

  // Firebase接続と自動ログイン
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);

    const params = new URLSearchParams(window.location.search);
    const adminParam = params.get("admin");
    const secretKey = process.env.NEXT_PUBLIC_ADMIN_SECRET;

    if (adminParam && secretKey && adminParam === secretKey) {
      setIsAdmin(true);
    }

    const unsubState = onValue(ref(db, "appState"), (s) => s.exists() && setAppState(s.val()));
    const unsubQuestions = onValue(ref(db, "questions"), (s) => s.exists() ? setQuestions(s.val()) : setQuestions({}));
    const unsubAnswers = onValue(ref(db, "currentAnswers"), (s) => s.exists() ? setCurrentAnswers(s.val()) : setCurrentAnswers({}));
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

  // 登録済み問題の復元
  useEffect(() => {
    if (isJoined && userName && questions && questions[userName]) {
      setMyQuestion(questions[userName]);
    }
  }, [questions, isJoined, userName]);

  // タイマー処理
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

  // 新問リセット
  useEffect(() => {
    setHasAnswered(false);
    setLocalStartTime(Date.now());
  }, [appState.currentQuestionId]);

  // 各問結果のアニメーション
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
        setRevealIndex((prev) => prev >= resultsArray.length ? (clearInterval(interval), prev) : prev + 1);
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [appState.mode, appState.currentQuestionId, currentAnswers, questions]);

  // 最終結果のアニメーション
  useEffect(() => {
    if (appState.mode === "finalResult" && !finalInitRef.current) {
      finalInitRef.current = true;
      const finalArr = Object.entries(users || {}).map(([name, data]) => ({ name, score: data.score, rank: 0 }));
      
      finalArr.sort((a, b) => b.score !== a.score ? b.score - a.score : a.name.localeCompare(b.name));
      let currentRank = 1, prevScore = -1;
      finalArr.forEach((item, idx) => {
        if (item.score !== prevScore) { currentRank = idx + 1; prevScore = item.score; }
        item.rank = currentRank;
      });
      finalArr.reverse();
      
      setSortedFinalResults(finalArr);
      setFinalRevealIndex(0);

      const interval = setInterval(() => {
        setFinalRevealIndex((prev) => prev >= finalArr.length ? (clearInterval(interval), prev) : prev + 1);
      }, 1500);
      return () => clearInterval(interval);
    } else if (appState.mode !== "finalResult") {
      finalInitRef.current = false;
    }
  }, [appState.mode, users]);

  // 正解表示タイマー
  useEffect(() => {
    if (appState.mode !== "result") return setShowCorrectAnswer(false);
    if (sortedResults.length === 0 || revealIndex === sortedResults.length) {
      const timer = setTimeout(() => setShowCorrectAnswer(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [appState.mode, revealIndex, sortedResults.length]);

  // 初期化時のキックアウト
  useEffect(() => {
    if (isJoined && userName && autoLoginProcessed.current && (!users || !users[userName])) {
      setIsJoined(false);
      setUserName("");
      localStorage.removeItem("quick_quiz_user_name");
      setMyQuestion({ text: "", choices: ["", "", "", ""], correctIndex: 0 });
    }
  }, [users, isJoined, userName]);

  // --- アクション関数 ---
  const join = async () => {
    if (!userName) return;
    const userRef = ref(db, `users/${userName}`);
    const snap = await get(userRef);
    
    if (snap.exists()) {
      setShowDuplicateModal(false);
      setTimeout(() => setShowDuplicateModal(true), 50);
      setTimeout(() => setShowDuplicateModal(false), 2500);
      return; 
    }

    await set(userRef, { score: 0, isOnline: true });
    onDisconnect(ref(db, `users/${userName}/isOnline`)).set(false);
    localStorage.setItem("quick_quiz_user_name", userName);
    if (questions[userName]) setMyQuestion(questions[userName]);
    setIsJoined(true);
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
      "appState/mode": "registration", "appState/currentQuestionId": null,
      "appState/askedQuestions": null, "users": null, "questions": null, "currentAnswers": null
    });
    setShowResetModal(false);
    setTimeout(() => setShowResetModal(true), 50);
    setTimeout(() => setShowResetModal(false), 2500);
  };

  const nextQuestion = async () => {
    const questionIds = Object.keys(questions || {});
    if (questionIds.length === 0) return alert("問題が登録されていません");

    const askedIds = appState.askedQuestions ? Object.keys(appState.askedQuestions) : [];
    const unaskedIds = questionIds.filter(id => !askedIds.includes(id));
    if (unaskedIds.length === 0) return alert("すべての問題が出題済みです。最終結果を発表してください。");

    const randomId = unaskedIds[Math.floor(Math.random() * unaskedIds.length)];
    await update(ref(db), {
      "appState/mode": "execution",
      "appState/currentQuestionId": randomId,
      "appState/questionStartTime": Date.now(),
      [`appState/askedQuestions/${randomId}`]: true,
      "currentAnswers": null
    });
  };

  const showResults = async () => {
    const currentQ = appState.currentQuestionId ? questions[appState.currentQuestionId] : null;
    if (currentQ) {
      const updates: any = {};
      const correctAnswers = Object.entries(currentAnswers)
        .filter(([, answerData]) => answerData.choice === currentQ.correctIndex)
        .sort(([, a], [, b]) => (a.timeTaken || 0) - (b.timeTaken || 0));

      correctAnswers.forEach(([userId], index) => {
        const points = index === 0 ? 4 : index === 1 ? 3 : index === 2 ? 2 : 1;
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
      choice: choiceIndex, timeTaken: (Date.now() - localStartTime) / 1000,
    });
  };

  return {
    userName, setUserName, isAdmin, isJoined, appState, questions, users, currentAnswers,
    myQuestion, setMyQuestion, timeLeft, hasAnswered, showSaveModal, showResetModal, showDuplicateModal,
    revealIndex, sortedResults, showCorrectAnswer, finalRevealIndex, sortedFinalResults,
    totalQuestions, askedCount, isLastQuestion,
    join, saveQuestion, setMode, resetGameToRegistration, nextQuestion, showResults, submitAnswer
  };
}