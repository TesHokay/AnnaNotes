import { useState } from 'react';
import { Hand, PenLine, Share, ShieldCheck, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useSettings } from '@/store/settings';
import { isAppleTouchDevice } from '@/lib/utils';

const STEPS = [
  {
    icon: PenLine,
    title: 'Пишите Apple Pencil',
    text: 'По умолчанию рисует только стилус, а пальцы листают и масштабируют. Рисование пальцем включается в настройках или в меню редактора.',
  },
  {
    icon: Hand,
    title: 'Жесты',
    text: 'Два пальца — масштаб и прокрутка. Касание двумя пальцами — отменить, тремя — повторить. Удержите перо в конце линии — она выпрямится, а фигура распознается.',
  },
  {
    icon: Undo2,
    title: 'Инструменты',
    text: 'Нажмите на активный инструмент ещё раз, чтобы открыть его настройки: цвет, толщину, тип пера, режим ластика и лассо.',
  },
  {
    icon: ShieldCheck,
    title: 'Ваши данные — только на устройстве',
    text: 'Заметки не отправляются на сервер и доступны без интернета. Делайте резервные копии в настройках: при удалении данных браузера заметки исчезнут.',
  },
  {
    icon: Share,
    title: 'Установите приложение',
    text: 'В Safari нажмите «Поделиться» → «На экран «Домой»». Затем один раз откройте установленное приложение при включённом интернете — после этого оно работает в авиарежиме.',
  },
];

export function Onboarding() {
  const done = useSettings((s) => s.onboardingDone);
  const loaded = useSettings((s) => s.loaded);
  const set = useSettings((s) => s.set);
  const [step, setStep] = useState(0);
  const steps = isAppleTouchDevice() ? STEPS : STEPS.slice(0, 4);
  const s = steps[step]!;
  const finish = () => set('onboardingDone', true);
  return (
    <Dialog open={loaded && !done} onOpenChange={(o) => !o && finish()}>
      <DialogContent className="max-w-md items-center text-center" hideClose>
        <div className="mt-2 grid h-16 w-16 place-items-center rounded-2xl bg-accent text-primary">
          <s.icon className="h-8 w-8" />
        </div>
        <DialogTitle>{s.title}</DialogTitle>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{s.text}</p>
        <div className="flex gap-1.5" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
          ))}
        </div>
        <div className="flex w-full gap-2">
          <Button variant="ghost" className="flex-1" onClick={finish}>
            Пропустить
          </Button>
          <Button className="flex-1" onClick={() => (step < steps.length - 1 ? setStep(step + 1) : finish())}>
            {step < steps.length - 1 ? 'Далее' : 'Начать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
