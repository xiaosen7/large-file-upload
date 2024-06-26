"use client";

import { Loading } from "@/shared/components/loading";
import { Input } from "@/shared/components/ui/input";
import { Progress } from "@/shared/components/ui/progress";
import { mp } from "@/shared/utils/jsx";
import {
  CheckIcon,
  ExclamationTriangleIcon,
  PauseIcon,
  PlayIcon,
  ReloadIcon,
  RocketIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useCreation, useLocalStorageState, useMemoizedFn } from "ahooks";
import { sentenceCase } from "change-case";
import { get, set, uniqueId } from "lodash-es";
import { useObservable } from "rcrx";
import React, { memo, useEffect, useRef, useState } from "react";
import { Observable, throttleTime } from "rxjs";
import { CHUNK_SIZE, CONCURRENCY } from "../constants";
import { IUploadClientActions, UploadClient } from "../models/client";
import { IUploadSetting, UploadSetting } from "./setting";

interface IFile extends File {
  id: string;
}

const AUTO_UPLOAD = true;

export interface IUploadProps {
  actions: IUploadClientActions;
}

export const Upload: React.FC<IUploadProps> = ({ actions }) => {
  const [files, setFiles] = useState<IFile[]>([]);
  const [setting, setSetting] = useLocalStorageState<IUploadSetting>(
    "uploadSetting",
    {
      defaultValue: {
        chunkSize: CHUNK_SIZE,
        concurrency: CONCURRENCY,
      },
    }
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainer = scrollContainerRef.current;

  const onChange = useMemoizedFn((async (e) => {
    const files = Array.from(e.target.files ?? []).map(
      (file) => set(file, "id", uniqueId()) as IFile
    );

    setFiles((pre) => [...pre, ...files]);

    if (scrollContainer) {
      setTimeout(() => {
        (scrollContainer.lastChild as HTMLDivElement | null)?.scrollIntoView({
          behavior: "smooth",
        });
      }, 500);
    }
  }) satisfies React.ComponentProps<"input">["onChange"]);

  return (
    <div className="flex flex-col gap-4 border border-solid p-4">
      <div className="flex gap-4">
        <Input className="flex-1" multiple type="file" onChange={onChange} />{" "}
        <UploadSetting
          value={setting}
          onChange={setSetting}
          disabled={files.length > 0}
        />
      </div>

      <div ref={scrollContainerRef} className="h-64 overflow-auto">
        {files.map((file) => (
          <UploadSingleFile
            key={file.id}
            actions={actions}
            file={file}
            onRemove={() =>
              setFiles((pre) => pre.filter((x) => x.id !== file.id))
            }
            {...setting}
          />
        ))}
      </div>
    </div>
  );
};

interface IUploadSingleFileProps {
  file: IFile;
  actions: IUploadClientActions;
  className?: string;
  onRemove?: () => void;
  concurrency?: number;
  chunkSize?: number;
}
const UploadSingleFile = memo(function UploadSingleFile(
  props: IUploadSingleFileProps
) {
  const { file, actions, onRemove, concurrency, chunkSize } = props;
  const destroyedRef = useRef(false);

  const client = useCreation(() => {
    return new UploadClient(file, actions, concurrency, chunkSize);
  }, [file, actions, destroyedRef.current, concurrency, chunkSize]);

  useEffect(() => {
    client.start(AUTO_UPLOAD);
  }, [client]);

  const onPlay = useMemoizedFn(() => {
    client.startPool();
  });

  const onStop = useMemoizedFn(() => {
    client.stopPool();
  });

  const onRestart = useMemoizedFn(() => {
    client.restart(AUTO_UPLOAD);
  });

  const state = useObservable(
    client.state$.pipe(
      throttleTime(200, undefined, { leading: false, trailing: true })
    ),
    client.state$.value
  );
  const error = useObservable(client.error$, null);

  useEffect(() => {
    return () => {
      client.destroy();
      destroyedRef.current = true;
    };
  }, [client]);

  const stateString =
    state === UploadClient.EState.Error && error
      ? get(error, "message")
      : state === UploadClient.EState.Default
      ? undefined
      : sentenceCase(UploadClient.EState[state]);

  return mp(
    props,
    <div className="py-2 flex flex-col gap-2">
      <div className="flex max-lg:flex-col gap-2 justify-between lg:items-center">
        <div title={file.name} className="truncate">
          {file.name}
        </div>

        <div title={stateString} className="text-xs truncate text-gray-500">
          {stateString}
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <RxProgress value$={client.progress$} />
        <div className="w-20 flex items-center justify-center">
          <UploaderController
            state$={client.state$}
            onPlay={onPlay}
            onStop={onStop}
            onRestart={onRestart}
          />
          <TrashIcon className="cursor-pointer ml-2" onClick={onRemove} />
        </div>
      </div>
    </div>
  );
});

interface IUploaderControllerProps {
  onPlay?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  state$: UploadClient["state$"];
}
const UploaderController: React.FC<IUploaderControllerProps> = ({
  onPlay,
  onStop,
  onRestart,
  state$,
}) => {
  const state = useObservable(
    state$.pipe(
      throttleTime(200, undefined, { leading: false, trailing: true })
    ),
    state$.value
  );

  switch (state) {
    case UploadClient.EState.Default:
      return null;

    case UploadClient.EState.CalculatingHash:
      return <span className="text-xs">Analysis...</span>;

    case UploadClient.EState.WaitForUpload:
    case UploadClient.EState.UploadStopped:
      return <PlayIcon onClick={onPlay} className="cursor-pointer" />;

    case UploadClient.EState.Uploading:
      return <PauseIcon onClick={onStop} className="cursor-pointer" />;

    case UploadClient.EState.UploadSuccessfully:
      return (
        <div className="flex gap-2">
          <CheckIcon />
          <ReloadIcon onClick={onRestart} className="cursor-pointer" />
        </div>
      );

    case UploadClient.EState.FastUploaded:
      return <RocketIcon />;

    case UploadClient.EState.Error:
      return (
        <div className="flex gap-2">
          <ExclamationTriangleIcon color="red" />{" "}
          <ReloadIcon onClick={onRestart} className="cursor-pointer" />
        </div>
      );

    default:
      return <Loading />;
  }
};

interface IUploaderInfoProps {
  value$: Observable<number>;
}
const RxProgress: React.FC<IUploaderInfoProps> = ({ value$ }) => {
  const value = useObservable(value$, 0);

  return <Progress className="h-1 my-2" value={value} />;
};
