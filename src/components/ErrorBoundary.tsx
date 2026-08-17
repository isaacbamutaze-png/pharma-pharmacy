import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg py-16">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
                <AlertTriangle size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-red-800">
                  Something went wrong on this page
                </p>
                <p className="text-xs text-red-600">
                  The page hit an unexpected error. Your data is safe — reload
                  to continue.
                </p>
              </div>
            </div>
            {this.state.error.message && (
              <p className="mt-4 rounded-lg bg-white/70 p-3 font-mono text-xs text-red-700">
                {this.state.error.message}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button onClick={this.reset}>Try again</Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RotateCcw size={15} />
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
