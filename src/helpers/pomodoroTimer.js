const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;

const state = {
  running: false,
  paused: false,
  mode: "idle",
  todo: null,
  todoListId: null,
  queue: [],
  queueIndex: 0,
  subTaskIndex: null,
  startedAt: null,
  endsAt: null,
  remainingSeconds: 0,
  workMinutes: DEFAULT_WORK_MINUTES,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  save: null,
};

let intervalId = null;
const subscribers = new Set();

function notifySubscribers() {
  subscribers.forEach((subscriber) => subscriber({ ...state }));
}

function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
}

function browserNotify(title, body) {
  if (!window.Notification || Notification.permission !== "granted") return;
  new Notification(title, { body });
}

function getTargetText(item) {
  if (!state.todo) return "";
  if (item.type === "subtask") return state.todo.subTaskList[item.index].text;
  return state.todo.text;
}

function currentItem() {
  return state.queue[state.queueIndex] || null;
}

function ensurePomodoro(target) {
  if (!target.pomodoro) {
    target.pomodoro = {
      completedSessions: 0,
      totalSeconds: 0,
      lastCompletedAt: null,
    };
  }
  return target.pomodoro;
}

function saveProgress() {
  if (typeof state.save === "function") state.save();
}

function recordCompletedWork() {
  const item = currentItem();
  if (!item || !state.todo) return;

  const target = item.type === "subtask" ? state.todo.subTaskList[item.index] : state.todo;
  const pomodoro = ensurePomodoro(target);
  pomodoro.completedSessions += 1;
  pomodoro.totalSeconds += state.workMinutes * 60;
  pomodoro.lastCompletedAt = new Date().toISOString();
  saveProgress();
}

function resetTimer() {
  if (intervalId) window.clearInterval(intervalId);
  intervalId = null;
}

function finishAll() {
  const text = state.todo ? state.todo.text : "Task";
  browserNotify("Pomodoro complete", `${text} is done with the planned pomodoro queue.`);
  resetTimer();
  state.running = false;
  state.paused = false;
  state.mode = "idle";
  state.queue = [];
  state.queueIndex = 0;
  state.subTaskIndex = null;
  state.startedAt = null;
  state.endsAt = null;
  state.remainingSeconds = 0;
  notifySubscribers();
}

function startPhase(mode) {
  const item = currentItem();
  if (!item) return finishAll();

  const minutes = mode === "work" ? state.workMinutes : state.breakMinutes;
  state.mode = mode;
  state.subTaskIndex = item.type === "subtask" ? item.index : null;
  state.startedAt = Date.now();
  state.endsAt = state.startedAt + minutes * 60 * 1000;
  state.remainingSeconds = minutes * 60;
  state.paused = false;

  resetTimer();
  intervalId = window.setInterval(tick, 1000);
  notifySubscribers();

  if (mode === "work") {
    browserNotify("Pomodoro started", getTargetText(item));
  } else {
    browserNotify("Break started", "Take a short break before the next pomodoro.");
  }
}

function completePhase() {
  if (state.mode === "work") {
    recordCompletedWork();
    const hasNext = state.queueIndex < state.queue.length - 1;
    if (hasNext && state.breakMinutes > 0) {
      startPhase("break");
    } else if (hasNext) {
      state.queueIndex += 1;
      startPhase("work");
    } else {
      finishAll();
    }
    return;
  }

  if (state.mode === "break") {
    state.queueIndex += 1;
    startPhase("work");
  }
}

function tick() {
  if (!state.running || state.paused) return;

  state.remainingSeconds = Math.ceil((state.endsAt - Date.now()) / 1000);
  if (state.remainingSeconds <= 0) {
    state.remainingSeconds = 0;
    notifySubscribers();
    completePhase();
    return;
  }

  notifySubscribers();
}

function buildQueue(todo, subTaskIndex = null) {
  if (subTaskIndex !== null && subTaskIndex !== undefined) {
    return [{ type: "subtask", index: subTaskIndex }];
  }

  if (todo.subTaskList && todo.subTaskList.length > 0) {
    const unchecked = todo.subTaskList
      .map((subTask, index) => ({ subTask, index }))
      .filter((item) => !item.subTask.checked)
      .map((item) => ({ type: "subtask", index: item.index }));

    if (unchecked.length > 0) return unchecked;
    return todo.subTaskList.map((subTask, index) => ({ type: "subtask", index }));
  }

  return [{ type: "task" }];
}

function start({ todo, todoListId, subTaskIndex = null, save, workMinutes = DEFAULT_WORK_MINUTES, breakMinutes = DEFAULT_BREAK_MINUTES }) {
  if (state.running) {
    const replace = window.confirm("A pomodoro is already running. Stop it and start this one?");
    if (!replace) return;
    stop();
  }

  state.running = true;
  state.todo = todo;
  state.todoListId = todoListId;
  state.queue = buildQueue(todo, subTaskIndex);
  state.queueIndex = 0;
  state.workMinutes = workMinutes;
  state.breakMinutes = breakMinutes;
  state.save = save;
  startPhase("work");
}

function pause() {
  if (!state.running || state.paused) return;
  state.paused = true;
  state.remainingSeconds = Math.ceil((state.endsAt - Date.now()) / 1000);
  resetTimer();
  notifySubscribers();
}

function resume() {
  if (!state.running || !state.paused) return;
  state.paused = false;
  state.endsAt = Date.now() + state.remainingSeconds * 1000;
  intervalId = window.setInterval(tick, 1000);
  notifySubscribers();
}

function stop() {
  resetTimer();
  state.running = false;
  state.paused = false;
  state.mode = "idle";
  state.todo = null;
  state.todoListId = null;
  state.queue = [];
  state.queueIndex = 0;
  state.subTaskIndex = null;
  state.startedAt = null;
  state.endsAt = null;
  state.remainingSeconds = 0;
  state.save = null;
  notifySubscribers();
}

function isActive(todo, todoListId, subTaskIndex = null) {
  return state.running && state.todo === todo && state.todoListId === todoListId && state.subTaskIndex === subTaskIndex;
}

function subscribe(callback) {
  subscribers.add(callback);
  callback({ ...state });
  return () => subscribers.delete(callback);
}

export default {
  start,
  pause,
  resume,
  stop,
  subscribe,
  isActive,
  getState: () => ({ ...state }),
  formatSeconds,
};
