import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Ban, RotateCcw } from "lucide-react";
import { Button, ButtonLink } from "../../components/Button.jsx";
import { Card } from "../../components/Layout.jsx";
import { FormAlert } from "../../components/Field.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useCancelGeneration, useGenerationJob, useRetryGeneration } from "../../hooks/useGenerationJob.js";
import { GenerationProgress } from "./GenerationProgress.jsx";
import { VisualWorkspace } from "./VisualWorkspace.jsx";

function CenteredCard({ children, testId }) {
  return (
    <div className="px-4 py-10 sm:px-6">
      <Card className="mx-auto max-w-2xl p-6 sm:p-8" data-testid={testId}>
        {children}
      </Card>
    </div>
  );
}

function OutcomeCard({ icon: Icon, tone, title, children, actions, testId }) {
  return (
    <CenteredCard testId={testId}>
      <Icon className={tone === "error" ? "h-8 w-8 text-red-700" : "h-8 w-8 text-stone-500"} aria-hidden="true" />
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-stone-900">{title}</h1>
      <div className="mt-2 space-y-3 text-sm text-stone-700">{children}</div>
      <div className="mt-6 flex flex-wrap gap-3">{actions}</div>
    </CenteredCard>
  );
}

export function GenerationResultPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { job, status, progress, safeError, polling, isLoading, error, refetch } = useGenerationJob(jobId);
  const cancel = useCancelGeneration(jobId);
  const retry = useRetryGeneration(jobId);

  function onCancel() {
    cancel.mutate(undefined, {
      onError: (err) => toast.error(err.message),
    });
  }

  function onRetry() {
    retry.mutate(undefined, {
      onSuccess: (data) => navigate(`/app/generations/${data.jobId}`),
      onError: (err) => {
        if (err.code === "ACTIVE_JOB_EXISTS" && err.details?.activeJobId) {
          navigate(`/app/generations/${err.details.activeJobId}`);
          return;
        }
        toast.error(err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message);
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-stone-600">
        <Spinner label="Loading generation" className="text-accent-700" />
        <span aria-hidden="true">Loading…</span>
      </div>
    );
  }

  if (error) {
    const notFound = error.status === 404;
    return (
      <OutcomeCard
        icon={AlertTriangle}
        tone="error"
        testId="generation-load-error"
        title={notFound ? "Generation not found" : "We couldn't load this generation"}
        actions={
          <>
            {!notFound && (
              <Button variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            )}
            <ButtonLink to="/app/create">Create a new visual</ButtonLink>
          </>
        }
      >
        <p>{notFound ? "It may have been deleted, or the link is incorrect." : error.message}</p>
        {error.requestId && <p className="text-xs text-stone-500">Reference: {error.requestId}</p>}
      </OutcomeCard>
    );
  }

  if (status === "completed" && job?.learningPlan && job?.sceneJson) {
    return <VisualWorkspace job={job} />;
  }

  if (status === "failed") {
    return (
      <OutcomeCard
        icon={AlertTriangle}
        tone="error"
        testId="generation-failed"
        title="This visual couldn't be generated"
        actions={
          <>
            <Button onClick={onRetry} loading={retry.isPending} loadingText="Retrying…">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <ButtonLink to="/app/create" variant="secondary">
              Edit prompt
            </ButtonLink>
          </>
        }
      >
        <FormAlert>{safeError?.message ?? "Something went wrong while generating your visual."}</FormAlert>
        <p className="text-xs text-stone-500">
          Reference: {jobId}
          {safeError?.code ? ` · ${safeError.code}` : ""}
        </p>
      </OutcomeCard>
    );
  }

  if (status === "cancelled") {
    return (
      <OutcomeCard
        icon={Ban}
        testId="generation-cancelled"
        title="Generation cancelled"
        actions={
          <>
            <Button onClick={onRetry} loading={retry.isPending} loadingText="Restarting…">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Run it again
            </Button>
            <ButtonLink to="/app/create" variant="secondary">
              New prompt
            </ButtonLink>
          </>
        }
      >
        <p>Nothing was saved from this run.</p>
      </OutcomeCard>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6">
      <GenerationProgress
        status={status}
        progress={progress}
        prompt={job?.prompt}
        inputType={job?.inputType ?? "prompt"}
        polling={polling}
        onCancel={onCancel}
        cancelling={cancel.isPending}
      />
    </div>
  );
}
