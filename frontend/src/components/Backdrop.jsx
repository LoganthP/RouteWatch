// Bright, colourful canvas behind the frosted-glass panels.
export default function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#E6F3FF] via-[#F4F9FF] to-[#FFF6DA]" />
      <div className="absolute -left-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-[#8CCBFF] opacity-60 blur-3xl animate-drift" />
      <div className="absolute right-[-10rem] top-[10%] h-[30rem] w-[30rem] rounded-full bg-[#FFD66B] opacity-55 blur-3xl animate-drift [animation-delay:-7s]" />
      <div className="absolute bottom-[-12rem] left-[25%] h-[32rem] w-[32rem] rounded-full bg-[#9EF0D4] opacity-50 blur-3xl animate-drift [animation-delay:-13s]" />
      <div className="absolute bottom-[5%] right-[8%] h-[20rem] w-[20rem] rounded-full bg-[#FFB3C2] opacity-40 blur-3xl animate-drift [animation-delay:-4s]" />
    </div>
  );
}
