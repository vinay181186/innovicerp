import { zodResolver } from '@hookform/resolvers/zod';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { rootRoute } from './__root';

const magicSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});
type MagicForm = z.infer<typeof magicSchema>;

const passwordSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password is at least 6 characters'),
});
type PasswordForm = z.infer<typeof passwordSchema>;

type Mode = 'magic' | 'password';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

function LoginPage() {
  const [mode, setMode] = useState<Mode>('magic');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  if (sentTo) {
    return (
      <main className="container max-w-md py-16">
        <div className="rounded-lg border bg-card p-8 text-card-foreground space-y-3 text-center">
          <Mail className="mx-auto h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Check your inbox</h1>
          <p className="text-sm text-muted-foreground">
            We sent a magic link to <span className="font-medium text-foreground">{sentTo}</span>.
            Click it to sign in.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="container max-w-md py-16">
      <div className="rounded-lg border bg-card p-8 text-card-foreground space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Innovic ERP</h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'magic'
              ? "Enter your work email. We'll send you a one-time sign-in link."
              : 'Enter your email and password.'}
          </p>
        </div>

        {mode === 'magic' ? (
          <MagicForm
            onSent={(email) => setSentTo(email)}
            onError={setError}
            onClearError={() => setError(null)}
            error={error}
          />
        ) : (
          <PasswordForm
            onSuccess={() => navigate({ to: '/', replace: true })}
            onError={setError}
            onClearError={() => setError(null)}
            error={error}
          />
        )}

        <div className="text-center text-sm">
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setError(null);
              setMode(mode === 'magic' ? 'password' : 'magic');
            }}
          >
            {mode === 'magic' ? 'Sign in with password instead' : 'Send a magic link instead'}
          </button>
        </div>
      </div>
    </main>
  );
}

function MagicForm(props: {
  onSent: (email: string) => void;
  onError: (msg: string) => void;
  onClearError: () => void;
  error: string | null;
}) {
  const form = useForm<MagicForm>({
    resolver: zodResolver(magicSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async ({ email }: MagicForm) => {
    props.onClearError();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      props.onError(err.message);
      return;
    }
    props.onSent(email);
  };

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          {...form.register('email')}
        />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>

      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}

      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Send magic link
      </Button>
    </form>
  );
}

function PasswordForm(props: {
  onSuccess: () => void;
  onError: (msg: string) => void;
  onClearError: () => void;
  error: string | null;
}) {
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async ({ email, password }: PasswordForm) => {
    props.onClearError();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      props.onError(err.message);
      return;
    }
    props.onSuccess();
  };

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          {...form.register('email')}
        />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
        ) : null}
      </div>

      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}

      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  );
}
