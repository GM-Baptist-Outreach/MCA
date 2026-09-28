import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  CheckCircle,
  BookOpen,
  Compass,
  Award,
  GraduationCap,
  Map,
  Target,
  HeartHandshake,
  ArrowRight,
} from "lucide-react";

const Index = () => {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative bg-primary text-primary-foreground py-20 lg:py-32 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src="https://vibe.filesafe.space/1784303289974857996/assets/1dff8118-30e1-48f6-8d46-b53f5e56eb70.png"
            alt="Parent and child studying together"
            className="w-full h-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-primary/80 mix-blend-multiply" />
        </div>

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl">
            <Link
              to="/our-approach"
              className="inline-flex items-center rounded-full border border-accent/50 bg-accent/10 px-4 py-1.5 text-sm font-semibold text-accent mb-6 hover:bg-accent/20 transition-colors"
            >
              Affordability. Convenience. Excellence.
            </Link>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-serif leading-tight mb-6 text-white">
              Give Your Child an Education That Actually Fits Them
            </h1>
            <p className="text-lg sm:text-xl text-primary-foreground/90 mb-8 max-w-2xl leading-relaxed">
              Accredited. Affordable. Built around how your student actually
              learns, not a one size fits all classroom.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                asChild
                size="lg"
                className="bg-accent text-primary hover:bg-accent/90 font-semibold text-lg"
              >
                <Link to="/enroll">Enroll</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="bg-transparent border-white text-white hover:bg-white/10 font-semibold text-lg"
              >
                <Link to="/curriculum-guide">
                  Get the Free Curriculum Guide
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-20 lg:py-28 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold font-serif text-primary mb-8 leading-tight">
              Homeschooling your student is a big decision, and it's easy to
              wonder if you're doing it right.
            </h2>
            <div className="text-lg text-foreground/80 space-y-6">
              <p>
                Will this curriculum actually hold up when it's time for college
                applications? Are you equipped to teach subjects you haven't
                touched since high school yourself? What happens if your student
                falls behind and you don't catch it in time?
              </p>
              <p className="text-xl font-semibold text-primary">
                You don't have to figure this out alone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Guide Section */}
      <section className="py-20 lg:py-28 bg-secondary relative overflow-hidden">
        <Compass className="absolute -right-24 top-1/2 -translate-y-1/2 h-96 w-96 text-primary/5 z-0" />
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 relative">
              <div className="aspect-[4/3] rounded-2xl overflow-hidden shadow-xl border-8 border-white">
                <img
                  src="https://vibe.filesafe.space/1784303289974857996/assets/1dff8118-30e1-48f6-8d46-b53f5e56eb70.png"
                  alt="Family learning together"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-3xl sm:text-4xl font-bold font-serif text-primary mb-6">
                Three generations, personally invested.
              </h2>
              <div className="space-y-6 text-lg text-foreground/80">
                <p>
                  Midwest Christian Academy isn't run by a company that's never
                  lived this. David Moore grew up in an A.C.E. school himself.
                  He and his wife homeschooled all five of their own children as
                  Midwest Christian Academy students. Today, his grandchildren
                  are enrolled too. Three generations of one family, personally
                  invested in the same curriculum they hand to your family.
                </p>
                <p>
                  Since 1982, MCA has helped families do this well. Our
                  graduates have gone on to every US Service Academy, Ivy League
                  schools, and state universities across the country, and into
                  careers in the military, medicine, law, and even the US
                  Congress.
                </p>
                <div className="pt-4">
                  <Button
                    asChild
                    variant="link"
                    className="p-0 h-auto text-accent hover:text-accent/80 text-lg font-semibold flex items-center gap-2"
                  >
                    <Link to="/our-story">
                      Read Our Full Story <ArrowRight className="h-5 w-5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Plan Section */}
      <section className="py-20 lg:py-28 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold font-serif text-primary mb-6">
              A simple path forward.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="bg-secondary/50 p-8 rounded-xl relative">
              <div className="text-5xl font-serif font-bold text-accent/20 absolute top-4 right-6">
                1
              </div>
              <div className="h-12 w-12 bg-primary text-white rounded-full flex items-center justify-center mb-6 relative z-10">
                <Map className="h-6 w-6" />
              </div>
              <p className="text-lg font-medium text-primary relative z-10">
                Reach out, or grab the Free Curriculum Guide if you're still
                deciding
              </p>
            </div>

            <div className="bg-secondary/50 p-8 rounded-xl relative">
              <div className="text-5xl font-serif font-bold text-accent/20 absolute top-4 right-6">
                2
              </div>
              <div className="h-12 w-12 bg-primary text-white rounded-full flex items-center justify-center mb-6 relative z-10">
                <Target className="h-6 w-6" />
              </div>
              <p className="text-lg font-medium text-primary relative z-10">
                We help you build the right plan for your child's grade level
                and needs
              </p>
            </div>

            <div className="bg-secondary/50 p-8 rounded-xl relative">
              <div className="text-5xl font-serif font-bold text-accent/20 absolute top-4 right-6">
                3
              </div>
              <div className="h-12 w-12 bg-primary text-white rounded-full flex items-center justify-center mb-6 relative z-10">
                <HeartHandshake className="h-6 w-6" />
              </div>
              <p className="text-lg font-medium text-primary relative z-10">
                You get ongoing support (record keeping, academic tracking,
                tutoring) so your student finishes strong
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 lg:py-28 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-5">
          <BookOpen className="absolute -left-24 -top-24 h-96 w-96" />
          <Compass className="absolute -right-24 -bottom-24 h-96 w-96" />
        </div>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold font-serif mb-8 text-white">
              How the A.C.E. System Works
            </h2>
            <p className="text-xl leading-relaxed text-primary-foreground/90">
              Every student learns differently. That's the whole idea behind the
              A.C.E. system: your child moves at their own pace, building on
              what they're already good at while strengthening the areas they're
              not. Full curriculum, complete record keeping, academic
              projections toward graduation, and Zoom tutoring support when you
              need it. Accredited and affordable, so you're not choosing between
              quality and what you can pay.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-background text-center relative overflow-hidden">
        <div className="container mx-auto px-4 relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold font-serif mb-8 text-primary">
            Your Child Deserves an Education Built Around Them
          </h2>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button
              asChild
              size="lg"
              className="bg-accent text-primary hover:bg-accent/90 font-semibold text-lg"
            >
              <Link to="/enroll">Enroll</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="bg-transparent border-primary text-primary hover:bg-primary/5 font-semibold text-lg"
            >
              <Link to="/curriculum-guide">Get the Free Curriculum Guide</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
