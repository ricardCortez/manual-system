import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";
import axios from "axios";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const msg = err.response?.data?.message;
        if (status === 401) setError("Email o contraseña incorrectos");
        else if (status === 423) setError("Cuenta bloqueada temporalmente. Intenta en 15 minutos.");
        else if (status === 403) setError(msg || "Cuenta desactivada");
        else setError("Error al conectar con el servidor");
      } else {
        setError("Error inesperado. Intenta nuevamente.");
      }
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg-primary)" }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--text-primary)", color: "var(--text-inverse)" }}
          >
            <BookOpen size={22} />
          </div>
          <h1 className="font-display text-2xl font-700" style={{ color: "var(--text-primary)" }}>
            Manual del Sistema
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
            Gestión de manuales y procesos internos
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div className="floating-label-group">
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder=" "
              required
              className="w-full px-3 rounded-xl text-sm outline-none transition-all"
              style={{
                height: 54,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--ai-primary)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
            />
            <label htmlFor="email">Correo electrónico</label>
          </div>

          {/* Password */}
          <div className="floating-label-group relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=" "
              required
              className="w-full px-3 pr-10 rounded-xl text-sm outline-none transition-all"
              style={{
                height: 54,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--ai-primary)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
            />
            <label htmlFor="password">Contraseña</label>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-tertiary)" }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm"
              style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading || !email || !password}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-500 transition-all"
            style={{
              background: "var(--text-primary)",
              color: "var(--text-inverse)",
              opacity: isLoading || !email || !password ? 0.6 : 1,
            }}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
            {isLoading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>

        <p className="text-center text-xs mt-8" style={{ color: "var(--text-disabled)" }}>
          Solo para uso interno · Red corporativa
        </p>
      </div>
    </div>
  );
}
