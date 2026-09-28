import { Compass, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const OurStory = () => {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <section className="bg-primary text-primary-foreground py-16 lg:py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 flex items-center justify-center pointer-events-none">
          <Compass className="w-96 h-96 -right-20 absolute" />
        </div>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl font-bold font-serif mb-6 text-white">
              Three Generations of Family
            </h1>
            <p className="text-xl text-primary-foreground/90 leading-relaxed">
              Midwest Christian Academy isn't run by a corporate board. We're a
              family, personally invested in the exact same education we provide
              to yours.
            </p>
          </div>
        </div>
      </section>

      {/* The History Section */}
      <section className="py-16 lg:py-24 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <div className="prose prose-lg prose-headings:font-serif prose-headings:text-primary prose-p:text-foreground/80 max-w-none">
              <p className="lead text-xl md:text-2xl font-serif text-primary mb-8">
                Every good story starts somewhere small. Ours started at a
                dining room table in Illinois.
              </p>

              <p>
                In 1982, John and Jan Walsh founded Midwest Christian Academy.
                Driven by a desire to help families confidently educate their
                children with a strong, Bible-based foundation, they started
                working from their own home. As more families found success with
                the A.C.E. curriculum, MCA grew steadily, eventually expanding
                into dedicated offices and warehouse space in Bloomington, IL.
              </p>

              <p>
                After decades of faithful service, the Walshes sold MCA in 2015
                to longtime employees Fred Moore and Cindy Walters. Fred and
                Cindy understood the mission deeply and continued to guide
                families with the same care and dedication.
              </p>

              <p>
                Ten years later, health issues led Fred Moore to retire in 2025.
                Knowing how important the academy's legacy was, Cindy Walters
                chose to sell MCA to Fred's son, David Moore.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Meet David Section */}
      <section className="py-16 lg:py-24 bg-secondary relative overflow-hidden">
        <BookOpen className="absolute -left-24 top-1/2 -translate-y-1/2 h-96 w-96 text-primary/5 z-0" />
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="relative">
              <div className="aspect-[4/5] rounded-2xl overflow-hidden shadow-xl border-8 border-white bg-background">
                <img
                  src="https://assets.cdn.filesafe.space/9YFQxlzS8RBbYsxQ9knD/media/6a980d24a1f3f48f4b95e6fe.jpg"
                  alt="David Moore, Owner of Midwest Christian Academy"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-6 -right-6 bg-primary text-primary-foreground p-6 rounded-xl shadow-lg max-w-xs">
                <p className="font-serif font-bold text-lg mb-1">David Moore</p>
                <p className="text-sm text-primary-foreground/80">
                  Owner & President
                </p>
              </div>
            </div>

            <div className="prose prose-lg prose-headings:font-serif prose-headings:text-primary prose-p:text-foreground/80 max-w-none">
              <h2 className="text-3xl sm:text-4xl font-bold mb-6">
                Meet David
              </h2>
              <p>
                For David, Midwest Christian Academy isn't just a business—it's
                the exact system that shaped his own life.
              </p>
              <p>
                David grew up in an A.C.E. school himself, experiencing the
                concept mastery philosophy firsthand. When he and his wife had
                children, they knew exactly how they wanted to educate them.
                They homeschooled all five of their children as Midwest
                Christian Academy students.
              </p>
              <p>
                Today, the legacy continues. David's grandchildren are now
                enrolled in MCA as well. That makes three generations of one
                family, personally invested in the exact same curriculum they
                provide to your family.
              </p>
              <p className="font-medium text-primary mt-6">
                When you call MCA, you aren't talking to a call center. You're
                talking to parents and grandparents who have walked the same
                road you are on.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-background text-center relative overflow-hidden">
        <div className="container mx-auto px-4 relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold font-serif mb-8 text-primary">
            Ready to join the MCA family?
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

export default OurStory;
