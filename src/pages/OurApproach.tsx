import { BookOpen, Target, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const OurApproach = () => {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <section className="bg-primary text-primary-foreground py-16 lg:py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 flex items-center justify-center pointer-events-none">
          <BookOpen className="w-96 h-96 -left-20 absolute" />
        </div>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl font-bold font-serif mb-6 text-white">
              The A.C.E. Philosophy
            </h1>
            <p className="text-xl text-primary-foreground/90 leading-relaxed">
              A Bible-based curriculum built on concept mastery. We believe
              every student is unique, and their education should reflect that.
            </p>
          </div>
        </div>
      </section>

      {/* Main Concept */}
      <section className="py-16 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 relative">
              <div className="aspect-[4/3] rounded-2xl overflow-hidden shadow-xl border-8 border-white bg-secondary">
                <img
                  src="https://vibe.filesafe.space/1784303289974857996/assets/6c577b08-93cf-4bbf-9f1e-251f35ef732e.png"
                  alt="Educational workbooks"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-3xl font-bold font-serif text-primary mb-6">
                Progress at Their Own Pace
              </h2>
              <p className="text-lg text-foreground/80 mb-6 leading-relaxed">
                Every student is different, with different strengths and
                different weaknesses. A traditional classroom forces everyone to
                move at the same speed, leaving some bored and others behind.
              </p>
              <p className="text-lg text-foreground/80 mb-8 leading-relaxed">
                The A.C.E. (Accelerated Christian Education) system lets a
                student progress at their own pace. They can build quickly on
                subjects they excel at, while taking the time needed to shore up
                areas where they struggle.
              </p>

              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <Target className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-serif text-primary mb-2">
                      Concept Mastery
                    </h3>
                    <p className="text-foreground/70">
                      Students don't move on until they have mastered the
                      current concept, ensuring a solid foundation for future
                      learning.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <BookOpen className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-serif text-primary mb-2">
                      Bible-Based
                    </h3>
                    <p className="text-foreground/70">
                      Character building and Biblical principles are woven
                      throughout the curriculum, not just added on as an extra
                      subject.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What We Provide */}
      <section className="py-20 bg-secondary">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold font-serif text-primary mb-6">
              More Than Just Books
            </h2>
            <p className="text-lg text-foreground/80">
              When you enroll with Midwest Christian Academy, you get a
              full-service educational partner to ensure your child's success.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="bg-background p-8 rounded-xl shadow-sm border border-border/50 flex gap-4">
              <BookOpen className="h-8 w-8 text-accent shrink-0" />
              <div>
                <h3 className="text-xl font-bold font-serif text-primary mb-2">
                  Full Curriculum
                </h3>
                <p className="text-foreground/70">
                  A complete, proven educational system that covers every
                  subject your child needs from K-12.
                </p>
              </div>
            </div>
            <div className="bg-background p-8 rounded-xl shadow-sm border border-border/50 flex gap-4">
              <ShieldCheck className="h-8 w-8 text-accent shrink-0" />
              <div>
                <h3 className="text-xl font-bold font-serif text-primary mb-2">
                  Record Keeping
                </h3>
                <p className="text-foreground/70">
                  We handle the transcripts, report cards, and permanent records
                  so you can focus on teaching.
                </p>
              </div>
            </div>
            <div className="bg-background p-8 rounded-xl shadow-sm border border-border/50 flex gap-4">
              <ArrowUpRight className="h-8 w-8 text-accent shrink-0" />
              <div>
                <h3 className="text-xl font-bold font-serif text-primary mb-2">
                  Academic Projections
                </h3>
                <p className="text-foreground/70">
                  Clear pathways mapped out from day one to ensure your child
                  meets all graduation requirements.
                </p>
              </div>
            </div>
            <div className="bg-background p-8 rounded-xl shadow-sm border border-border/50 flex gap-4">
              <Target className="h-8 w-8 text-accent shrink-0" />
              <div>
                <h3 className="text-xl font-bold font-serif text-primary mb-2">
                  Zoom Tutoring Support
                </h3>
                <p className="text-foreground/70">
                  When a concept is tough, you aren't alone. We provide Zoom
                  call tutoring support to help your child break through.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Accreditation & Affordability */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold font-serif mb-8 text-white">
              Accredited and Affordable
            </h2>
            <p className="text-xl leading-relaxed text-primary-foreground/90 mb-8">
              We know the two things parents worry about most: "Will this
              count?" and "Can we afford it?"
            </p>
            <p className="text-lg leading-relaxed text-primary-foreground/80">
              Midwest Christian Academy is fully accredited, meaning the hard
              work your child puts in will be recognized by colleges and
              employers. And because we believe Christian education shouldn't be
              out of reach, we've kept our program affordable so you never have
              to choose between quality and what you can pay.
            </p>
          </div>
        </div>
      </section>

      {/* Outcomes */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold font-serif mb-8 text-primary">
              Outcomes That Speak for Themselves
            </h2>
            <p className="text-xl leading-relaxed text-foreground/80 mb-8">
              Our curriculum holds up when it matters most—college applications,
              career paths, and life after graduation.
            </p>
            <div className="bg-secondary/50 p-8 rounded-2xl border border-border/50">
              <p className="text-lg font-medium text-primary">
                MCA graduates have been accepted into every US Service Academy,
                Ivy League schools, and state universities across the country.
                They have gone on to serve in the military, medicine, law, and
                even the US Congress.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-secondary text-center relative overflow-hidden">
        <div className="container mx-auto px-4 relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold font-serif mb-8 text-primary">
            Ready to Build the Right Plan for Your Child?
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

export default OurApproach;
