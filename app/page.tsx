"use client";

import { useRef, useEffect } from "react";
import { useQuizApp } from "../hooks/useQuizApp";
import { ref, update } from "firebase/database";
import { db } from "../lib/firebase";

export default function Home() {
  const {
    lineProfile, userName, isAdmin, isJoined, appState, questions, users, currentAnswers,
    myQuestion, setMyQuestion, timeLeft, hasAnswered, showSaveModal, showResetModal,
    countdownValue, showReadyScreen,
    revealIndex, sortedResults, showCorrectAnswer, finalRevealIndex, sortedFinalResults,
    totalQuestions, askedCount, isLastQuestion,
    loginWithLine, join, toggleReady, saveQuestion, setMode, resetGameToRegistration,
    removeUser, nextQuestion, showResults, submitAnswer
  } = useQuizApp();

  const isOwner = !!process.env.NEXT_PUBLIC_OWNER_LINE_ID &&
    lineProfile?.userId === process.env.NEXT_PUBLIC_OWNER_LINE_ID;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [myQuestion.text, appState.mode]);

  // --- ロビーコンポーネント（登録モード・結果モード共用） ---
  const LobbyUI = () => {
    const userEntries = Object.entries(users || {});
    const isReady = users[userName]?.isReady || false;
    const showReadyBtn = appState.mode === "registration" || appState.mode === "result";

    return (
      <div className="p-4 bg-white rounded-xl shadow text-left">
        <h4 className="font-bold mb-4 text-gray-700 flex items-center gap-2">
          <span>{appState.mode === "result" ? "次の問題への準備" : "ロビー"}</span>
          <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full">{userEntries.length} 人</span>
        </h4>

        {userEntries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-2">待機中のメンバーはいません</p>
        ) : (
          <div className="flex flex-wrap gap-6 justify-center py-2">
            {userEntries.map(([name, data]) => {
              const isOnline = data.isOnline !== false;
              const ready = data.isReady === true;
              return (
                <div key={name} className="flex flex-col items-center gap-1 w-16">
                  <div className={`relative w-14 h-14 rounded-full ${ready ? "ring-4 ring-green-400" : ""}`}>
                    {data.pictureUrl ? (
                      <img
                        src={data.pictureUrl}
                        alt={name}
                        className={`w-14 h-14 rounded-full object-cover transition-opacity duration-300 ${isOnline ? "opacity-100" : "opacity-30"}`}
                      />
                    ) : (
                      <div className={`w-14 h-14 rounded-full bg-gray-300 flex items-center justify-center text-2xl transition-opacity duration-300 ${isOnline ? "opacity-100" : "opacity-30"}`}>
                        👤
                      </div>
                    )}
                    {!isOnline && (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 font-bold">
                        
                      </div>
                    )}
                    {/* オーナー専用：自分以外のユーザーを強制削除ボタン */}
                    {isOwner && name !== userName && (
                      <button
                        onClick={() => removeUser(name)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs font-bold flex items-center justify-center shadow-md leading-none"
                        title={`${name}を削除`}
                      >
                        −
                      </button>
                    )}
                  </div>
                  <span className={`text-xs font-medium text-center break-all leading-tight ${!isOnline ? "text-gray-400" : "text-gray-700"}`}>
                    {name === userName ? `${name}(あなた)` : name}
                  </span>
                  {ready && (
                    <span className="text-xs font-bold text-green-600 bg-green-50 px-1 py-0.5 rounded">準備完了</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showReadyBtn && (() => {
          const questionSaved = !!questions[userName];
          const canReady = appState.mode !== "registration" || questionSaved;
          return (
            <button
              onClick={toggleReady}
              disabled={!canReady}
              className={`mt-6 w-full py-3 rounded-xl font-bold text-lg transition-all ${
                !canReady
                  ? "bg-gray-100 text-gray-400 border-2 border-gray-200 cursor-not-allowed"
                  : isReady
                    ? "bg-green-500 text-white shadow-lg"
                    : "bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-gray-200"
              }`}
            >
              {!canReady ? "先に問題を保存してね" : isReady ? "✅ 準備完了！" : "準備できたら押してね"}
            </button>
          );
        })()}
      </div>
    );
  };

  // --- UI: LINEログイン画面 ---
  if (!lineProfile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md flex flex-col items-center">
          <h1 className="text-3xl font-extrabold mb-2 text-black tracking-tight">早押しクイズ</h1>
          <p className="text-gray-500 mb-8 font-medium">LINEアカウントでログインしてください</p>
          <button
            onClick={loginWithLine}
            className="w-full bg-[#06C755] text-white px-8 py-4 rounded-xl text-xl font-bold shadow-md hover:bg-[#05b34d] transition-colors flex items-center justify-center gap-3"
          >
            <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
            </svg>
            LINEでログイン
          </button>
        </div>
      </div>
    );
  }

  // --- UI: 参加ボタン画面 ---
  if (!isJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        {showResetModal && (
          <div className="fixed top-6 right-6 z-50 bg-red-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border border-red-400">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-extrabold text-lg">初期化しました</p>
              <p className="text-xs text-red-100">全データがクリアされました</p>
            </div>
          </div>
        )}
        <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md flex flex-col items-center">
          <img
            src={lineProfile.pictureUrl || ""}
            alt={lineProfile.displayName}
            className="w-24 h-24 rounded-full object-cover mb-4 shadow"
          />
          <h1 className="text-2xl font-extrabold mb-1 text-black">{lineProfile.displayName}</h1>
          <p className="text-gray-500 mb-8 text-sm">このアカウントで参加しますか？</p>
          <button
            onClick={join}
            className="w-full bg-blue-500 text-white px-8 py-4 rounded-xl text-xl font-bold shadow-md hover:bg-blue-600 transition-colors"
          >
            参加する
          </button>
        </div>
      </div>
    );
  }

  // --- UI: カウントダウン画面 ---
  if (appState.mode === "countdown") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
        {showReadyScreen ? (
          <div className="text-center animate-bounce">
            <p className="text-6xl font-extrabold tracking-widest text-yellow-400">Ready?</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-9xl font-black text-yellow-400 drop-shadow-lg">{countdownValue}</p>
          </div>
        )}
      </div>
    );
  }

  // --- UI: メイン画面 ---
  return (
    <div className="min-h-screen bg-gray-100 p-4 text-black relative overflow-hidden">

      {/* オーナー専用：右上解散ボタン常設 */}
      {isOwner && (
        <button
          onClick={resetGameToRegistration}
          className="fixed top-4 right-4 z-50 bg-red-500 hover:bg-red-600 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg transition-colors"
        >
          🚪 解散
        </button>
      )}

      {showSaveModal && (
        <div className="fixed top-6 right-6 z-50 bg-green-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border border-green-400 animate-toast">
          <span className="text-2xl">✨</span>
          <div>
            <p className="font-extrabold text-lg">保存が完了しました！</p>
            <p className="text-xs text-green-100">再編集可能です</p>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto space-y-6">

        {/* 管理者パネル */}
        {isAdmin && (
          <div className="bg-white p-4 rounded-lg shadow border-2 border-blue-500">
            <h2 className="text-xl font-bold mb-4 text-blue-600">管理者 ({askedCount}/{totalQuestions}問消化)</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={resetGameToRegistration} className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded text-sm font-bold border border-red-300">
                部屋を解散する
              </button>
              {appState.mode === "execution" && (
                <button onClick={showResults} className="bg-purple-500 text-white px-4 py-2 rounded font-bold">結果発表演出へ</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label>制限時間(秒):</label>
              <input
                type="number"
                value={appState.timeLimit}
                onChange={(e) => update(ref(db, "appState"), { timeLimit: Number(e.target.value) })}
                className="border p-1 w-20"
              />
            </div>
          </div>
        )}

        {/* ロビー（登録モード） */}
        {appState.mode === "registration" && <LobbyUI />}

        {/* 問題作成エリア（登録モード） */}
        {appState.mode === "registration" && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-2xl font-bold mb-2">問題を作成する</h2>
            <p className="mb-6 text-gray-500 text-sm">問題を作成してください。何度でも編集・上書き保存できます。</p>

            <textarea
              ref={textareaRef}
              rows={2}
              placeholder="問題文（例: 世界で一番高い山は？）"
              value={myQuestion.text}
              onChange={(e) => setMyQuestion({ ...myQuestion, text: e.target.value })}
              className="w-full border-2 p-3 rounded-xl mb-6 text-black focus:border-blue-500 focus:outline-none text-lg font-medium resize-none overflow-hidden leading-snug min-h-[5rem]"
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
                    <div className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 ${isCorrect ? "border-green-500 bg-green-50/60 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300"}`}>
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
          </div>
        )}

        {/* 実行モード */}
        {appState.mode === "execution" && appState.currentQuestionId && (
          <div className="bg-white p-6 rounded-lg shadow text-center">
            {timeLeft > 0 && (
              <div className="flex flex-col items-center justify-center mb-6">
                <div className={`w-28 h-28 rounded-full flex items-center justify-center shadow-lg border-4 transition-colors duration-300 ${timeLeft <= 5 ? "bg-red-600 border-red-800" : "bg-red-500 border-red-600"}`}>
                  <span className="text-6xl font-black text-white drop-shadow-md">{timeLeft}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 mb-4">
              {users[appState.currentQuestionId]?.pictureUrl ? (
                <img
                  src={users[appState.currentQuestionId].pictureUrl}
                  alt={appState.currentQuestionId}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <span className="text-xl">👤</span>
              )}
              <p className="text-sm text-gray-500">出題者: <span className="font-bold text-gray-700">{appState.currentQuestionId}</span></p>
            </div>

            {timeLeft === 0 ? (
              <div className="text-2xl font-bold py-10">タイムアップ！結果発表をお待ちください...</div>
            ) : appState.currentQuestionId === userName ? (
              <div className="text-xl py-10">あなたの問題が出題中です！<br />他の人の回答を待ちましょう。</div>
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

        {/* 各問の結果発表 */}
        {appState.mode === "result" && appState.currentQuestionId && (
          <div className="bg-white p-6 rounded-lg shadow text-center overflow-hidden">
            {showCorrectAnswer && (
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
                <p>集計中...</p>
              )
            ) : (
              <div className="flex flex-col gap-2">
                {sortedResults.slice(0, revealIndex).reverse().map((result) => (
                  <div
                    key={result.name}
                    className={`flex flex-col p-3 md:p-4 rounded-xl border-2 shadow-sm animate-slide-in-right ${
                      result.isCorrect ? "bg-red-50 border-red-200 text-red-700 font-bold" : "bg-gray-100 border-gray-300 text-gray-500"
                    }`}
                  >
                    <div className="flex justify-between items-center text-lg md:text-xl w-full">
                      <div className="flex items-center gap-2 w-1/3">
                        {users[result.name]?.pictureUrl ? (
                          <img src={users[result.name].pictureUrl} alt={result.name} className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <span>👤</span>
                        )}
                        <span className="truncate">{result.name}</span>
                      </div>
                      <span className="w-1/3 text-center">{result.timeTaken.toFixed(3)} 秒</span>
                      <span className="w-1/3 text-right">{result.isCorrect ? "⭕️ 正解" : "❌ 不正解"}</span>
                    </div>
                    {result.name === userName && (
                      <div className={`mt-2 pt-2 border-t text-right text-sm font-bold w-full ${result.isCorrect ? "border-red-200 text-red-800" : "border-gray-300 text-gray-600"}`}>
                        今回の獲得: +{result.pointsEarned || 0} pt ／ 現在の合計: {users[userName]?.score || 0} pt
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 正解表示後に次の問題への準備ロビーを表示 */}
            {showCorrectAnswer && (
              <div className="mt-8">
                <LobbyUI />
              </div>
            )}
          </div>
        )}

        {/* 最終結果発表 */}
        {appState.mode === "finalResult" && (
          <div className="bg-white p-6 rounded-lg shadow text-center overflow-hidden">
            <h2 className="text-4xl font-extrabold mb-8 text-amber-500 animate-bounce">🏆 最終結果発表 🏆</h2>
            <p className="text-md text-gray-500 mb-6">全問終了！これまでの合計成績ランキングです！</p>

            {sortedFinalResults.length === 0 ? (
              <p>データがありません。</p>
            ) : (
              <div className="flex flex-col gap-2">
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
                        isTop ? "bg-amber-50 border-amber-400 font-extrabold text-amber-900" : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div className="flex items-center gap-3 font-bold text-left truncate">
                        {item.pictureUrl ? (
                          <img src={item.pictureUrl} alt={item.name} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <span>👤</span>
                        )}
                        <span>{medal}{item.rank}位: {item.name}</span>
                      </div>
                      <span className="text-blue-600 font-extrabold text-right">{item.score} pt</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ロビーに戻るボタン */}
            {finalRevealIndex >= sortedFinalResults.length && sortedFinalResults.length > 0 && (
              <button
                onClick={resetGameToRegistration}
                className="mt-8 w-full bg-blue-500 hover:bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow transition-colors"
              >
                🏠 ロビーに戻る
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
