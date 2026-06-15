"use client";

import { useState, useEffect, useRef } from "react";
import { db, auth, signInAnonymously } from "../lib/firebase";
import { ref, onValue, set, update, get, onDisconnect } from "firebase/database";

// --- 型定義 ---
type AppState = {
  mode: "registration" | "execution" | "result" | "finalResult";
  timeLimit: number;
  currentQuestionId: string | null;
  questionStartTime: number;
  askedQuestions?: Record<string, boolean>;
};

type Question = {
  text: string;
  choices: string[];
  correctIndex: number;
};

type UserData = { score: number; isOnline?: boolean };

type AnswerData = {
  choice: number;
  timeTaken: number;
  pointsEarned?: number;
};

export default function Home() {
  // --- ユーザー状態 ---
  const [userName, setUserName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isJoined, setIsJoined] = useState(false);

  // --- アプリ全体の状態 (Firebaseと同期) ---
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

  // --- ローカル状態 ---
  const [myQuestion, setMyQuestion] = useState<Question>({
    text: "",
    choices: ["", "", "", ""],
    correctIndex: 0,
  });
  const [timeLeft, setTimeLeft] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [localStartTime, setLocalStartTime] = useState(0);

  // --- モーダルアニメーション用の状態 ---
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // --- 各問の結果発表アニメーション用の状態 ---
  const [revealIndex, setRevealIndex] = useState(0);
  const [sortedResults, setSortedResults] = useState<any[]>([]);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);

  // --- 最終結果発表アニメーション用の状態 ---
  const [finalRevealIndex, setFinalRevealIndex] = useState(0);
  const [sortedFinalResults, setSortedFinalResults] = useState<any[]>([]);
  const finalInitRef = useRef(false);

  const autoLoginProcessed = useRef(false);

  // --- 進行状況の計算 ---
  const totalQuestions = Object.keys(questions || {}).length;
  const askedCount = appState.askedQuestions ? Object.keys(appState.askedQuestions).length : 0;
  const isLastQuestion = totalQuestions > 0 && askedCount >= totalQuestions;

  // --- Firebaseデータの購読 & 自動ログインチェック ---
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);

    const params = new URLSearchParams(window.location.search);
    const adminParam = params.get("admin");
    const secretKey = process.env.NEXT_PUBLIC_ADMIN_SECRET;

    if (adminParam && secretKey && adminParam === secretKey) {
      setIsAdmin(true);
    }

    const unsubState = onValue(ref(db, "appState"), (s) => {
      if (s.exists()) setAppState(s.val());
    });
    const unsubQuestions = onValue(ref(db, "questions"), (s) => {
      if (s.exists()) setQuestions(s.val());
      else setQuestions({});
    });
    const unsubAnswers = onValue(ref(db, "currentAnswers"), (s) => {
      if (s.exists()) setCurrentAnswers(s.val());
      else setCurrentAnswers({});
    });

    const unsubUsers = onValue(ref(db, "users"), (s) => {
      const usersData = s.exists() ? s.val() : {};
      setUsers(usersData);

      if (!autoLoginProcessed.current) {
        autoLoginProcessed.current = true;
        const savedName = localStorage.getItem("quick_quiz_user_name");
        
        if (savedName) {
          if (usersData[savedName]) {
            setUserName(savedName);
            setIsJoined(true);
            update(ref(db, `users/${savedName}`), { isOnline: true });
            onDisconnect(ref(db, `users/${savedName}/isOnline`)).set(false);
          } else {
            localStorage.removeItem("quick_quiz_user_name");
          }
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

  // --- 再読み込み時に、登録済みの問題データを自動で復元するロジック ---
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

  // 新しい問題が出た時のリセット処理
  useEffect(() => {
    setHasAnswered(false);
    setLocalStartTime(Date.now());
  }, [appState.currentQuestionId]);

  // --- 各問の結果発表アニメーションの処理 ---
  useEffect(() => {
    if (appState.mode === "result" && appState.currentQuestionId) {
      const currentQ = questions[appState.currentQuestionId];
      if (!currentQ) return;

      const resultsArray = Object.entries(currentAnswers).map(([name, data]) => {
        const isCorrect = data.choice === currentQ.correctIndex;
        return {
          name,
          isCorrect,
          timeTaken: data.timeTaken || 0,
          choice: data.choice,
          pointsEarned: data.pointsEarned || 0,
        };
      });

      resultsArray.sort((a, b) => {
        if (a.isCorrect !== b.isCorrect) return a.isCorrect ? 1 : -1;
        return b.timeTaken - a.timeTaken;
      });

      setSortedResults(resultsArray);
      setRevealIndex(0);

      const interval = setInterval(() => {
        setRevealIndex((prev) => {
          if (prev >= resultsArray.length) {
            clearInterval(interval);
            return prev;
          }
          return prev + 1;
        });
      }, 1500);

      return () => clearInterval(interval);
    }
  }, [appState.mode, appState.currentQuestionId, currentAnswers, questions]);

  // --- 最終結果のアニメーション処理 ---
  useEffect(() => {
    if (appState.mode === "finalResult" && !finalInitRef.current) {
      finalInitRef.current = true;

      const finalArr = Object.entries(users || {}).map(([name, data]) => ({
        name,
        score: data.score,
        rank: 0,
      }));
      
      finalArr.sort((a, b) => b.score - a.score);
      finalArr.forEach((item, idx) => {
        item.rank = idx + 1;
      });

      finalArr.sort((a, b) => a.score - b.score);
      
      setSortedFinalResults(finalArr);
      setFinalRevealIndex(0);

      const interval = setInterval(() => {
        setFinalRevealIndex((prev) => {
          if (prev >= finalArr.length) {
            clearInterval(interval);
            return prev;
          }
          return prev + 1;
        });
      }, 1500);

      return () => clearInterval(interval);
    } else if (appState.mode !== "finalResult") {
      finalInitRef.current = false;
    }
  }, [appState.mode, users]);

  // --- 全員表示しきってから1秒後に正解を出すタイマー制御 ---
  useEffect(() => {
    if (appState.mode !== "result") {
      setShowCorrectAnswer(false);
      return;
    }

    if (sortedResults.length === 0 || revealIndex === sortedResults.length) {
      const timer = setTimeout(() => {
        setShowCorrectAnswer(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [appState.mode, revealIndex, sortedResults.length]);

  // --- 初期化時の自動キックアウト用ロジック ---
  useEffect(() => {
    if (isJoined && userName) {
      if (autoLoginProcessed.current && (!users || !users[userName])) {
        setIsJoined(false);
        setUserName("");
        localStorage.removeItem("quick_quiz_user_name");
        setMyQuestion({ text: "", choices: ["", "", "", ""], correctIndex: 0 });
      }
    }
  }, [users, isJoined, userName]);

  // --- アクション関数 ---
  const join = async () => {
    if (!userName) return;
    try {
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

      if (questions[userName]) {
        setMyQuestion(questions[userName]);
      }
      setIsJoined(true);
    } catch (error) {
      console.error("参加登録エラー:", error);
    }
  };

  const saveQuestion = async () => {
    try {
      await set(ref(db, `questions/${userName}`), myQuestion);
      
      setShowSaveModal(false);
      setTimeout(() => setShowSaveModal(true), 50);
      setTimeout(() => setShowSaveModal(false), 2500);

    } catch (error) {
      console.error("保存エラー:", error);
    }
  };

  const setMode = async (mode: AppState["mode"]) => {
    await update(ref(db, "appState"), { mode });
  };

  const resetGameToRegistration = async () => {
    try {
      const updates: any = {};
      updates["appState/mode"] = "registration";
      updates["appState/currentQuestionId"] = null;
      updates["appState/askedQuestions"] = null;
      updates["users"] = null;
      updates["questions"] = null;
      updates["currentAnswers"] = null;
      
      await update(ref(db), updates);

      setShowResetModal(false);
      setTimeout(() => setShowResetModal(true), 50);
      setTimeout(() => setShowResetModal(false), 2500);

    } catch (error) {
      console.error("初期化エラー:", error);
    }
  };

  const nextQuestion = async () => {
    const questionIds = Object.keys(questions || {});
    if (questionIds.length === 0) return alert("問題が登録されていません");

    const askedIds = appState.askedQuestions ? Object.keys(appState.askedQuestions) : [];
    const unaskedIds = questionIds.filter(id => !askedIds.includes(id));

    if (unaskedIds.length === 0) {
      return alert("すべての問題が出題済みです。最終結果を発表してください。");
    }

    const randomId = unaskedIds[Math.floor(Math.random() * unaskedIds.length)];

    const updates: any = {};
    updates["appState/mode"] = "execution";
    updates["appState/currentQuestionId"] = randomId;
    updates["appState/questionStartTime"] = Date.now();
    updates[`appState/askedQuestions/${randomId}`] = true;

    await update(ref(db), updates);
    await set(ref(db, "currentAnswers"), null);
  };

  const showResults = async () => {
    const currentQ = appState.currentQuestionId ? questions[appState.currentQuestionId] : null;
    if (currentQ) {
      const updates: any = {};
      
      const correctAnswers = Object.entries(currentAnswers)
        .filter(([, answerData]) => answerData.choice === currentQ.correctIndex)
        .sort(([, a], [, b]) => (a.timeTaken || 0) - (b.timeTaken || 0));

      correctAnswers.forEach(([userId], index) => {
        let points = 1;
        if (index === 0) points += 3;
        else if (index === 1) points += 2;
        else if (index === 2) points += 1;

        const currentScore = users[userId]?.score || 0;
        updates[`users/${userId}/score`] = currentScore + points;
        updates[`currentAnswers/${userId}/pointsEarned`] = points;
      });

      if (Object.keys(updates).length > 0) {
        await update(ref(db), updates);
      }
    }
    await setMode("result");
  };

  const submitAnswer = async (choiceIndex: number) => {
    if (hasAnswered || timeLeft === 0) return;
    setHasAnswered(true);
    const timeTaken = (Date.now() - localStartTime) / 1000;
    
    await set(ref(db, `currentAnswers/${userName}`), {
      choice: choiceIndex,
      timeTaken: timeTaken,
    });
  };

  // --- 参加者一覧コンポーネント ---
  const MemberListUI = () => {
    const userEntries = Object.entries(users || {});
    return (
      <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-gray-200 text-left">
        <h4 className="font-bold mb-3 text-gray-700 flex justify-between items-center">
          <span>現在参加中のメンバー</span>
          <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full">{userEntries.length} 人</span>
        </h4>
        {userEntries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-2">待機中のメンバーはいません</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {userEntries.map(([name, data]) => {
              const isOnline = data.isOnline !== false;
              return (
                <span 
                  key={name} 
                  className={`px-3 py-1 rounded-full text-sm font-medium border transition-all duration-300 ${
                    name === userName 
                      ? "bg-blue-100 text-blue-800 border-blue-300 font-bold" 
                      : !isOnline
                        ? "bg-gray-200 text-gray-400 border-gray-200 opacity-50" 
                        : "bg-white text-gray-700 border-gray-300 shadow-sm"
                  }`}
                >
                  {isOnline ? "👤" : "💤"} {name} {name === userName ? "(あなた)" : ""}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // --- 名前登録画面のUI描画 ---
  if (!isJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4 relative overflow-hidden">
        
        {showResetModal && (
          <div className="fixed top-6 right-6 z-50 bg-red-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border border-red-400 animate-toast-danger">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-extrabold text-lg">初期化しました</p>
              <p className="text-xs text-red-100">全データがクリアされ、登録モードへ戻りました</p>
            </div>
          </div>
        )}

        {showDuplicateModal && (
          <div className="fixed top-6 right-6 z-50 bg-red-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border border-red-400 animate-toast-danger">
            <span className="text-2xl">🚫</span>
            <div>
              <p className="font-extrabold text-lg">登録できません</p>
              <p className="text-xs text-red-100">その名前は既に使われています</p>
            </div>
          </div>
        )}

        <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md flex flex-col items-center">
          <h1 className="text-3xl font-extrabold mb-2 text-black tracking-tight">早押しクイズ</h1>
          <p className="text-gray-500 mb-8 font-medium">参加する名前を入力してください</p>
          
          <input
            type="text"
            placeholder="（例）たろう"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="w-full border-2 border-gray-300 p-4 rounded-xl text-xl mb-6 text-black focus:border-blue-500 focus:outline-none font-bold text-center"
          />
          <button 
            onClick={join} 
            disabled={!userName} 
            className="w-full bg-blue-500 text-white px-8 py-4 rounded-xl text-xl font-bold shadow-md hover:bg-blue-600 disabled:bg-gray-300 transition-colors"
          >
            参加する
          </button>
        </div>
      </div>
    );
  }

  // --- メイン画面（問題作成・クイズ実行）のUI描画 ---
  return (
    <div className="min-h-screen bg-gray-100 p-4 text-black relative overflow-hidden">
      
      {/* 保存完了モーダル */}
      {showSaveModal && (
        <div className="fixed top-6 right-6 z-50 bg-green-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border border-green-400 animate-toast">
          <span className="text-2xl">✨</span>
          <div>
            <p className="font-extrabold text-lg">保存が完了しました！</p>
            <p className="text-xs text-green-100">再編集可能です</p>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* --- 管理者パネル --- */}
        {isAdmin && (
          <div className="bg-white p-4 rounded-lg shadow mb-8 border-2 border-blue-500">
            <h2 className="text-xl font-bold mb-4 text-blue-600">管理者コントロール ({askedCount}/{totalQuestions}問消化)</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={resetGameToRegistration} className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded text-sm font-bold border border-red-300">
                初期化
              </button>
              
              {appState.mode !== "result" || !isLastQuestion ? (
                <button onClick={nextQuestion} className="bg-green-500 text-white px-4 py-2 rounded font-bold">出題</button>
              ) : null}

              {appState.mode === "result" && isLastQuestion && (
                <button onClick={() => setMode("finalResult")} className="bg-amber-500 text-white px-6 py-2 rounded-xl font-extrabold shadow animate-pulse">
                  🏆最終結果🏆
                </button>
              )}

              {appState.mode === "execution" && (
                <button onClick={showResults} className="bg-purple-500 text-white px-4 py-2 rounded font-bold">結果発表演出へ</button>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <label>制限時間(秒):</label>
              <input
                type="number"
                value={appState.timeLimit}
                onChange={(e) => update(ref(db, "appState"), { timeLimit: Number(e.target.value) })}
                className="border p-1 w-20"
              />
            </div>
            <MemberListUI />
          </div>
        )}

        {/* --- 登録モード --- */}
        {appState.mode === "registration" && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-2xl font-bold mb-2">問題作成画面</h2>
            <p className="mb-6 text-gray-500 text-sm">各自クイズを1問作成してください。何度でも編集・上書き保存できます。</p>
            
            <input
              type="text"
              placeholder="問題文（例: 世界で一番高い山は？）"
              value={myQuestion.text}
              onChange={(e) => setMyQuestion({ ...myQuestion, text: e.target.value })}
              className="w-full border-2 p-3 rounded-xl mb-6 text-black focus:border-blue-500 focus:outline-none text-lg font-medium"
            />

            <div className="space-y-4 mb-6">
              {myQuestion.choices.map((choice, idx) => {
                const isCorrect = myQuestion.correctIndex === idx;
                return (
                  <div key={idx} className="relative flex flex-col pt-2">
                    {isCorrect && (
                      <div className="absolute -top-3 left-10 z-10 bg-green-500 text-white text-xs px-2.5 py-1 rounded-lg rounded-bl-none font-extrabold shadow-sm animate-bounce">
                        正解はこれ！👇
                      </div>
                    )}

                    <div 
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 ${
                        isCorrect 
                          ? "border-green-500 bg-green-50/60 shadow-sm" 
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="correctAnswer"
                        checked={isCorrect}
                        onChange={() => setMyQuestion({ ...myQuestion, correctIndex: idx })}
                        className="w-6 h-6 accent-green-600 cursor-pointer"
                      />
                      <input
                        type="text"
                        placeholder={`選択肢 ${idx + 1}`}
                        value={choice}
                        onChange={(e) => {
                          const newChoices = [...myQuestion.choices];
                          newChoices[idx] = e.target.value;
                          setMyQuestion({ ...myQuestion, choices: newChoices });
                        }}
                        className="flex-1 border-0 bg-transparent p-1 text-lg text-black focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={saveQuestion} className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold shadow hover:bg-blue-600 transition-colors text-lg">
              問題を保存する
            </button>

            {!isAdmin && <MemberListUI />}
          </div>
        )}

        {/* --- 実行モード --- */}
        {appState.mode === "execution" && appState.currentQuestionId && (
          <div className="bg-white p-6 rounded-lg shadow text-center">
            
            {/* 【変更】animate-pulse を削除し、色だけスッと変わるように修正 */}
            {timeLeft > 0 && (
              <div className="flex flex-col items-center justify-center mb-6">
                <div className={`w-28 h-28 rounded-full flex items-center justify-center shadow-lg border-4 transition-colors duration-300 ${
                  timeLeft <= 5 ? "bg-red-600 border-red-800" : "bg-red-500 border-red-600"
                }`}>
                  <span className="text-6xl font-black text-white drop-shadow-md">{timeLeft}</span>
                </div>
              </div>
            )}

            <p className="text-sm text-gray-500 mb-2">出題者: {appState.currentQuestionId}</p>
            
            {timeLeft === 0 ? (
              <div className="text-2xl font-bold py-10">タイムアップ！結果発表をお待ちください...</div>
            ) : appState.currentQuestionId === userName ? (
              <div className="text-xl py-10">あなたの問題が出題中です！<br/>他の人の回答を待ちましょう。</div>
            ) : (
              <>
                <h2 className="text-2xl font-bold mb-8">{questions[appState.currentQuestionId]?.text}</h2>
                <div className="grid grid-cols-1 gap-4">
                  {questions[appState.currentQuestionId]?.choices.map((choice, idx) => (
                    <button
                      key={idx}
                      onClick={() => submitAnswer(idx)}
                      disabled={hasAnswered}
                      className={`py-4 rounded-lg text-xl font-bold transition-all ${
                        hasAnswered
                          ? currentAnswers[userName]?.choice === idx
                            ? "bg-blue-500 text-white"
                            : "bg-gray-200 text-gray-400"
                          : "bg-gray-100 hover:bg-gray-200 border-2 border-gray-300"
                      }`}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
                {hasAnswered && <p className="mt-6 text-blue-600 font-bold">回答を受け付けました！</p>}
              </>
            )}
          </div>
        )}

        {/* --- 各問の結果発表モード --- */}
        {appState.mode === "result" && appState.currentQuestionId && (
          <div className="bg-white p-6 rounded-lg shadow text-center overflow-hidden"> 
            {showCorrectAnswer && sortedResults.length > 0 && (
              <div className="mb-8 p-4 bg-yellow-100 border-4 border-yellow-400 rounded-lg animate-pulse">
                <h2 className="text-xl font-bold text-gray-700 mb-2">正解は...</h2>
                <p className="text-4xl font-extrabold text-red-600">
                  「{questions[appState.currentQuestionId].choices[questions[appState.currentQuestionId].correctIndex]}」
                </p>
                <p className="text-xl font-bold text-gray-700 mt-2">です！</p>
              </div>
            )}

            <h3 className="text-xl font-bold mb-6 text-gray-500">今回の結果</h3>

            {sortedResults.length === 0 ? (
              showCorrectAnswer ? (
                <div className="mb-8 p-4 bg-yellow-100 border-4 border-yellow-400 rounded-lg">
                  <p className="text-xl font-bold text-gray-700 mb-2">誰も回答しませんでした！正解は...</p>
                  <p className="text-4xl font-extrabold text-red-600">
                    「{questions[appState.currentQuestionId].choices[questions[appState.currentQuestionId].correctIndex]}」
                  </p>
                </div>
              ) : (
                <p>回答者がいませんでした。</p>
              )
            ) : (
              <div className="flex flex-col gap-2 transition-all duration-500">
                {sortedResults.slice(0, revealIndex).reverse().map((result) => (
                  <div 
                    key={result.name}
                    className={`flex flex-col p-3 md:p-4 rounded-xl border-2 shadow-sm animate-slide-in-right ${
                      result.isCorrect 
                        ? "bg-red-50 border-red-200 text-red-700 font-bold" 
                        : "bg-gray-100 border-gray-300 text-gray-500"
                    }`}
                  >
                    <div className="flex justify-between items-center text-lg md:text-xl w-full">
                      <span className="w-1/3 text-left truncate">{result.name}</span>
                      <span className="w-1/3 text-center">{result.timeTaken.toFixed(3)} 秒</span>
                      <span className="w-1/3 text-right">{result.isCorrect ? "⭕️ 正解" : "❌ 不正解"}</span>
                    </div>
                    
                    {result.name === userName && (
                      <div className={`mt-2 pt-2 border-t text-right text-sm font-bold w-full ${result.isCorrect ? 'border-red-200 text-red-800' : 'border-gray-300 text-gray-600'}`}>
                        今回の獲得: +{result.pointsEarned || 0} pt ／ 現在の合計: {users[userName]?.score || 0} pt
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- 最終結果発表モード --- */}
        {appState.mode === "finalResult" && (
          <div className="bg-white p-6 rounded-lg shadow text-center overflow-hidden">
            <h2 className="text-4xl font-extrabold mb-8 text-amber-500 animate-bounce">🏆 最終結果発表 🏆</h2>
            <p className="text-md text-gray-500 mb-6">全問終了！これまでの合計成績ランキングです！</p>
            
            {sortedFinalResults.length === 0 ? (
              <p>データがありません。</p>
            ) : (
              <div className="flex flex-col gap-2 transition-all duration-500">
                {sortedFinalResults.slice(0, finalRevealIndex).reverse().map((item) => {
                  let medal = "";
                  if (item.rank === 1) medal = "🥇 ";
                  else if (item.rank === 2) medal = "🥈 ";
                  else if (item.rank === 3) medal = "🥉 ";

                  const isTop = item.rank === 1;

                  return (
                    <div 
                      key={item.name} 
                      className={`flex justify-between items-center text-xl p-4 rounded-lg border-2 shadow-sm animate-slide-in-right ${
                        isTop 
                          ? "bg-amber-50 border-amber-400 font-extrabold text-amber-900" 
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <span className="font-bold text-left truncate">
                        {medal}{item.rank}位: {item.name}
                      </span>
                      <span className="text-blue-600 font-extrabold text-right">
                        {item.score} pt
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}