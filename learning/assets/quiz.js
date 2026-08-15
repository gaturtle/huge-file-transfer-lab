// Shared quiz component for lessons.
// Usage: <div class="quiz" data-answer="the exact answer" data-hint="optional hint">
//          <p class="q">Question text?</p>
//          <input type="text" autocomplete="off" spellcheck="false">
//          <button>Check</button>
//          <p class="feedback"></p>
//        </div>
// Call initQuizzes() once on page load.
function initQuizzes() {
  document.querySelectorAll('.quiz').forEach(function (quiz) {
    var input = quiz.querySelector('input[type="text"]');
    var button = quiz.querySelector('button');
    var feedback = quiz.querySelector('.feedback');
    var answer = (quiz.dataset.answer || '').trim().toLowerCase();

    function check() {
      var given = (input.value || '').trim().toLowerCase();
      if (!given) { return; }
      if (given === answer) {
        feedback.textContent = 'Correct.';
        feedback.className = 'feedback correct';
      } else {
        feedback.textContent = quiz.dataset.hint
          ? 'Not quite. Hint: ' + quiz.dataset.hint
          : 'Not quite — try again.';
        feedback.className = 'feedback incorrect';
      }
    }

    button.addEventListener('click', check);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { check(); }
    });
  });
}
document.addEventListener('DOMContentLoaded', initQuizzes);
