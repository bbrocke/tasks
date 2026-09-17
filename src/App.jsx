import React, { useState, useEffect, useRef } from "react";
import { Plus, Check, Repeat, X, LayoutGrid, ChevronRight, Flame } from "lucide-react";
import { supabase, supabaseConfigError } from "./supabase";

export default function App() {
  const [lists, setLists] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [active, setActive] = useState("dashboard");
  const [drafts, setDrafts] = useState({});
  const draft = drafts[active]?.text ?? "";
  const draftRecur = drafts[active]?.recur ?? false;
  const [loading, setLoading] = useState(true);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const pendingRef = useRef(new Set());
  const [pendingTasks, setPendingTasks] = useState(new Set());

  const updateDraft = (changes) => {
    setDrafts((current) => ({
      ...current,
      [active]: { ...current[active], ...changes },
    }));
  };

  // Ref locks take effect immediately, even before React renders disabled buttons.
  const beginTaskSave = (id) => {
    if (pendingRef.current.has(id)) return false;
    pendingRef.current.add(id);
    setPendingTasks(new Set(pendingRef.current));
    setError(null);
    return true;
  };
  const endTaskSave = (id) => {
    pendingRef.current.delete(id);
    setPendingTasks(new Set(pendingRef.current));
  };

  const navigateTo = (next) => {
    const hash = `#/${encodeURIComponent(String(next))}`;
    if (window.location.hash === hash) {
      setActive(String(next));
    } else {
      window.location.hash = hash;
    }
  };

  // Load lists + tasks from Supabase on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supabaseConfigError) {
        setError(`${supabaseConfigError} Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, then redeploy.`);
        setLoading(false);
        return;
      }

      try {
        const [listsRes, tasksRes] = await Promise.all([
          supabase.from("lists").select("*").order("sort_order"),
          supabase.from("tasks").select("*").order("created_at"),
        ]);
        if (cancelled) return;
        if (listsRes.error || tasksRes.error) {
          setError("Couldn't load your tasks. Check your connection and refresh.");
        } else {
          setLists(listsRes.data ?? []);
          setTasks(tasksRes.data ?? []);
          setListsLoaded(true);
        }
      } catch {
        if (!cancelled) setError("Couldn't load your tasks. Check your connection and refresh.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // A saved list link cannot be validated until the initial request succeeds.
    if (!listsLoaded) return;
    const syncActiveFromHash = () => {
      let candidate;
      try {
        candidate = decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
      } catch {
        window.history.replaceState(null, "", "#/dashboard");
        setActive("dashboard");
        return;
      }
      const next =
        !candidate || candidate === "dashboard" || lists.some((item) => String(item.id) === candidate)
          ? candidate || "dashboard"
          : "dashboard";

      if (next === "dashboard" && candidate && candidate !== "dashboard") {
        window.history.replaceState(null, "", "#/dashboard");
      }
      setActive(next);
    };

    syncActiveFromHash();
    window.addEventListener("hashchange", syncActiveFromHash);
    return () => window.removeEventListener("hashchange", syncActiveFromHash);
  }, [lists, listsLoaded]);

  const tasksFor = (listId) => tasks.filter((t) => t.list_id === listId);

  const addTask = async (listId) => {
    const text = draft.trim();
    if (!text || addingRef.current || !supabase) return;
    addingRef.current = true;
    const newTask = {
      list_id: listId,
      text,
      done: false,
      recur: draftRecur ? "custom" : null,
      streak: 0,
    };
    setAdding(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase.from("tasks").insert(newTask).select().single();
      if (insertError || !data) throw insertError ?? new Error("No task was returned");
      setTasks((current) => [...current, data]);
      setDrafts((current) => ({ ...current, [listId]: { text: "", recur: false } }));
    } catch {
      setError("Couldn't add that task. Try again.");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const toggleTask = async (task) => {
    if (!supabase || !beginTaskSave(task.id)) return;
    const nowDone = !task.done;
    let streak = task.streak || 0;
    if (task.recur) streak = nowDone ? streak + 1 : Math.max(0, streak - 1);

    // Optimistic update, then persist
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: nowDone, streak } : t)));
    try {
      const { data, error: updateError } = await supabase
        .from("tasks")
        .update({ done: nowDone, streak })
        .eq("id", task.id)
        .select()
        .single();
      if (updateError || !data) throw updateError ?? new Error("No task was updated");
      setTasks((ts) => ts.map((t) => (t.id === task.id ? data : t)));
    } catch {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
      setError("Couldn't save that change. Try again.");
    } finally {
      endTaskSave(task.id);
    }
  };

  const removeTask = async (task) => {
    if (!supabase || pendingRef.current.has(task.id)) return;
    if (!window.confirm(`Delete "${task.text}"? This cannot be undone.`)) return;
    if (!beginTaskSave(task.id)) return;
    try {
      const { data, error: deleteError } = await supabase
        .from("tasks").delete().eq("id", task.id).select("id").single();
      if (deleteError || !data) throw deleteError ?? new Error("No task was deleted");
      setTasks((ts) => ts.filter((t) => t.id !== task.id));
    } catch {
      setError("Couldn't delete that task. Try again.");
    } finally {
      endTaskSave(task.id);
    }
  };

  const list = lists.find((l) => String(l.id) === active);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: "#665F50", background: "#F7F5F0" }}>
        Loading your spread…
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ fontFamily: "'Source Sans Pro', system-ui, sans-serif", background: "#F7F5F0", minHeight: "100vh", display: "flex", color: "#2B2B28" }}>
      {/* Tabbed spine sidebar */}
      <aside className="app-sidebar" style={{ background: "#EDEAE2", borderRight: "1px solid #DCD8CC", display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          className="sidebar-dashboard"
          onClick={() => navigateTo("dashboard")}
          title="Dashboard"
          style={{ borderRadius: 10, border: "none", background: active === "dashboard" ? "#2B2B28" : "transparent", color: active === "dashboard" ? "#F7F5F0" : "#2B2B28", cursor: "pointer", marginBottom: 10 }}
        >
          <LayoutGrid size={18} />
          <span className="sidebar-dashboard-label">Dashboard</span>
        </button>
        {lists.map((l) => {
          const count = tasksFor(l.id).filter((t) => !t.done).length;
          return (
            <button
              className="sidebar-list-button"
              key={l.id}
              onClick={() => navigateTo(l.id)}
              title={l.name}
              style={{ border: "none", cursor: "pointer", background: active === String(l.id) ? l.tape : "transparent", borderLeft: `5px solid ${l.color}` }}
            >
              <span className="sidebar-count" style={{ color: l.color }}>
                {count > 0 ? count : ""}
              </span>
              <span className="sidebar-label" style={{ color: "#2B2B28" }}>
                {l.name}
              </span>
              <span className="sidebar-label-compact" style={{ color: "#2B2B28" }}>
                {l.name.split(" ")[0].slice(0, 4)}
              </span>
            </button>
          );
        })}
      </aside>

      {/* Main content */}
      <main className="main-content" style={{ flex: 1, padding: "32px 40px", maxWidth: 720 }}>
        {error && (
          <div role="alert" style={{ background: "#F7E3E0", color: "#A0453B", fontSize: 13, padding: "8px 12px", borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}
        {active === "dashboard" ? (
          <>
            <h1 style={{ fontFamily: "'Georgia', serif", fontSize: 28, margin: "0 0 4px", letterSpacing: -0.3 }}>
              This week's spread
            </h1>
            <p style={{ color: "#7A756A", marginTop: 0, marginBottom: 28, fontSize: 14 }}>
              One glance at every list, like your master overview page.
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              {lists.map((l) => {
                const open = tasksFor(l.id).filter((t) => !t.done);
                const bestStreak = Math.max(0, ...tasksFor(l.id).map((t) => t.streak || 0));
                return (
                  <button
                    key={l.id}
                    onClick={() => navigateTo(l.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF", border: "1px solid #E4E0D5", borderLeft: `6px solid ${l.color}`, borderRadius: 10, padding: "14px 18px", cursor: "pointer", textAlign: "left" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{l.name}</div>
                      <div style={{ fontSize: 13, color: "#665F50", marginTop: 2 }}>
                        {open.length === 0
                          ? "All caught up"
                          : `${open.length} open · ${open.slice(0, 2).map((t) => t.text).join(", ")}${open.length > 2 ? "…" : ""}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {bestStreak > 0 && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: "#C6702B" }}>
                          <Flame size={13} /> {bestStreak}
                        </span>
                      )}
                      <ChevronRight size={18} color="#B5AF9E" />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : list ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: list.color, display: "inline-block" }} />
              <h1 style={{ fontFamily: "'Georgia', serif", fontSize: 26, margin: 0 }}>{list.name}</h1>
            </div>
            <p style={{ color: "#7A756A", marginTop: 4, marginBottom: 24, fontSize: 14 }}>
              {tasksFor(list.id).filter((t) => !t.done).length} open task
              {tasksFor(list.id).filter((t) => !t.done).length === 1 ? "" : "s"}
            </p>

            <form className="task-form" onSubmit={(event) => { event.preventDefault(); addTask(list.id); }} aria-busy={adding} style={{ display: "flex", gap: 8, marginBottom: 22 }}>
              <input
                aria-label={`Add a task to ${list.name}`}
                value={draft}
                onChange={(e) => updateDraft({ text: e.target.value })}
                disabled={adding}
                placeholder="Add a task…"
                style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #DCD8CC", fontSize: 14, outline: "none" }}
              />
              <button
                type="button"
                onClick={() => updateDraft({ recur: !draftRecur })}
                disabled={adding}
                aria-pressed={draftRecur}
                aria-label="Mark task as recurring"
                title="Mark recurring"
                style={{ width: 40, borderRadius: 8, border: "1px solid #DCD8CC", background: draftRecur ? list.tape : "#FFF", color: draftRecur ? list.color : "#B5AF9E", cursor: "pointer" }}
              >
                <Repeat size={16} style={{ margin: "auto" }} />
              </button>
              <button
                type="submit"
                aria-label="Add task"
                disabled={!draft.trim() || adding}
                style={{ width: 40, borderRadius: 8, border: "none", background: list.color, color: "#fff", cursor: !draft.trim() || adding ? "not-allowed" : "pointer", opacity: !draft.trim() || adding ? 0.55 : 1 }}
              >
                <Plus size={18} style={{ margin: "auto" }} />
              </button>
            </form>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasksFor(list.id).length === 0 && (
                <div style={{ color: "#B5AF9E", fontSize: 14, fontStyle: "italic" }}>
                  Nothing here yet — add your first task above.
                </div>
              )}
              {tasksFor(list.id).map((task) => (
                <div className="task-row" key={task.id} aria-busy={pendingTasks.has(task.id)} style={{ display: "flex", alignItems: "center", gap: 10, background: "#FFFFFF", border: "1px solid #E4E0D5", borderRadius: 8, padding: "10px 12px", opacity: task.done ? 0.5 : 1 }}>
                  <button
                    onClick={() => toggleTask(task)}
                    disabled={pendingTasks.has(task.id)}
                    aria-label={`${task.done ? "Mark incomplete" : "Mark complete"}: ${task.text}`}
                    style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${list.color}`, background: task.done ? list.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                  >
                    {task.done && <Check size={12} color="#fff" />}
                  </button>
                  <span style={{ flex: 1, fontSize: 14, textDecoration: task.done ? "line-through" : "none" }}>
                    {task.text}
                  </span>
                  {pendingTasks.has(task.id) && <span role="status" style={{ fontSize: 12, color: "#665F50" }}>Saving…</span>}
                  {task.recur && (task.streak || 0) > 0 && (
                    <span title={`Streak: ${task.streak}`} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 700, color: "#C6702B" }}>
                      <Flame size={13} /> {task.streak}
                    </span>
                  )}
                  {task.recur && (
                    <span title={`Repeats: ${task.recur}`} style={{ color: list.color }}>
                      <Repeat size={14} />
                    </span>
                  )}
                  <button
                    onClick={() => removeTask(task)}
                    disabled={pendingTasks.has(task.id)}
                    aria-label={`Delete task: ${task.text}`}
                    style={{ border: "none", background: "transparent", color: "#C9C4B5", cursor: "pointer" }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
